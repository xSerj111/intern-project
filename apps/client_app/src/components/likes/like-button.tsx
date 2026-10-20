'use client';

import { Heart } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import type { ILikeState } from '@repo/contracts';

import {
  likeComment,
  likePost,
  unlikeComment,
  unlikePost,
} from '../../lib/api/likes';
import { useAuth } from '../../lib/auth/auth-context';
import { cx } from '../../lib/cx';
import { formatCount } from '../../lib/format/time';

import styles from './like-button.module.css';

interface LikeButtonProps {
  target: 'post' | 'comment';
  targetId: string;
  initialLiked: boolean;
  initialCount: number;
  /** `action` is the large post-action-row button; `compact` suits comments. */
  variant?: 'action' | 'compact';
}

interface View {
  liked: boolean;
  count: number;
}

const requests = {
  post: { like: likePost, unlike: unlikePost },
  comment: { like: likeComment, unlike: unlikeComment },
} as const;

/** What to show: the server state, adjusted by any toggle still waiting to be sent. */
function project(server: ILikeState, wantLiked: boolean): View {
  if (server.liked === wantLiked) {
    return { liked: server.liked, count: server.likeCount };
  }
  const delta = wantLiked ? 1 : -1;
  return { liked: wantLiked, count: Math.max(0, server.likeCount + delta) };
}

/**
 * Like toggle with an optimistic count. Requests are serialised (one in flight,
 * rapid clicks collapse into the latest wanted state), and every response from
 * the server replaces the local liked/count values, so the server always wins.
 */
export function LikeButton({
  target,
  targetId,
  initialLiked,
  initialCount,
  variant = 'action',
}: LikeButtonProps) {
  const { getAccessToken, isSignedIn } = useAuth();
  const [view, setView] = useState<View>({
    liked: initialLiked,
    count: initialCount,
  });
  const [failed, setFailed] = useState(false);
  // Bumped on every like so the heart replays its pop animation.
  const [popKey, setPopKey] = useState(0);

  // Last state confirmed by the server, the state the user wants, and a lock.
  const confirmed = useRef<ILikeState>({
    liked: initialLiked,
    likeCount: initialCount,
  });
  const wanted = useRef(initialLiked);
  const busy = useRef(false);

  // Adopt fresher props (e.g. a refetched feed) while nothing is in flight.
  useEffect(() => {
    if (busy.current) {
      return;
    }
    confirmed.current = { liked: initialLiked, likeCount: initialCount };
    wanted.current = initialLiked;
    setView({ liked: initialLiked, count: initialCount });
  }, [initialLiked, initialCount]);

  async function flush() {
    if (busy.current) {
      return;
    }
    busy.current = true;
    try {
      while (wanted.current !== confirmed.current.liked) {
        const sent = wanted.current;
        const request = requests[target][sent ? 'like' : 'unlike'];
        const result = await request(targetId, { token: getAccessToken() });
        confirmed.current = result;
        // No newer click while this was in flight: accept whatever the server says.
        if (wanted.current === sent) {
          wanted.current = result.liked;
        }
        setView(project(result, wanted.current));
      }
    } catch {
      // Roll back to the last server-confirmed state.
      wanted.current = confirmed.current.liked;
      setView(project(confirmed.current, wanted.current));
      setFailed(true);
    } finally {
      busy.current = false;
    }
  }

  function toggle() {
    setFailed(false);
    wanted.current = !wanted.current;
    if (wanted.current) setPopKey((key) => key + 1);
    setView(project(confirmed.current, wanted.current));
    void flush();
  }

  const label = view.liked ? 'Unlike' : 'Like';
  const iconSize = variant === 'action' ? 24 : 16;

  return (
    <span className={styles.wrapper}>
      <button
        type="button"
        className={cx(
          styles.button,
          styles[variant],
          view.liked && styles.liked,
        )}
        onClick={toggle}
        disabled={!isSignedIn}
        aria-pressed={view.liked}
        aria-label={`${label} (${view.count})`}
        title={isSignedIn ? label : 'Sign in to like'}
      >
        <span
          key={popKey}
          className={cx(styles.icon, view.liked && popKey > 0 && styles.pop)}
          aria-hidden="true"
        >
          <Heart
            size={iconSize}
            fill={view.liked ? 'currentColor' : 'none'}
            strokeWidth={variant === 'action' ? 1.75 : 2}
          />
        </span>
        {view.count > 0 && (
          <span className={styles.count} aria-hidden="true">
            {formatCount(view.count)}
          </span>
        )}
      </button>
      {failed && (
        <span className={styles.error} role="alert">
          Couldn&apos;t update the like.
        </span>
      )}
    </span>
  );
}
