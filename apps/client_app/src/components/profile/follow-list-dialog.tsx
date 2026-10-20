'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';

import type { IChatUser } from '@repo/contracts';

import {
  followKeys,
  listFollowers,
  listFollowing,
} from '../../lib/api/follows';
import { getUsersByIds } from '../../lib/api/profile';
import { useAuth } from '../../lib/auth/auth-context';
import { FollowButton } from '../follows/follow-button';
import { Avatar } from '../ui/avatar';
import { Dialog } from '../ui/dialog';
import { RowSkeleton, SkeletonGroup } from '../ui/skeleton';

import { LoadError } from './load-error';
import styles from './follow-list-dialog.module.css';

export type FollowListKind = 'followers' | 'following';

/** The lookup endpoint accepts at most this many ids per request. */
const MAX_USERS = 100;

interface FollowListDialogProps {
  open: boolean;
  onClose: () => void;
  /** Auth user id whose followers / following are listed. */
  userId: string;
  kind: FollowListKind;
}

/** Modal list of a user's followers or followees, with Follow buttons. */
export function FollowListDialog({
  open,
  onClose,
  userId,
  kind,
}: FollowListDialogProps) {
  const { accessToken, user, isHydrated } = useAuth();
  const auth = { token: accessToken };

  const list = useQuery({
    queryKey: [
      ...(kind === 'followers'
        ? followKeys.followers(userId)
        : followKeys.following(userId)),
      'users',
    ],
    queryFn: async ({ signal }): Promise<IChatUser[]> => {
      const follows =
        kind === 'followers'
          ? await listFollowers(userId, { ...auth, signal })
          : await listFollowing(userId, { ...auth, signal });
      const ids = follows
        .map((follow) =>
          kind === 'followers' ? follow.followerId : follow.followingId,
        )
        .slice(0, MAX_USERS);
      const users = await getUsersByIds(ids, accessToken, signal);
      const byId = new Map(users.map((entry) => [entry.userId, entry]));
      // Keep the server's order (newest first).
      return ids.flatMap((id) => byId.get(id) ?? []);
    },
    enabled: open && isHydrated,
  });

  // Who the viewer already follows, to render the right button state per row.
  const mine = useQuery({
    queryKey: [...followKeys.following(user?.id ?? ''), 'ids'],
    queryFn: async ({ signal }) =>
      (await listFollowing(user!.id, { ...auth, signal })).map(
        (follow) => follow.followingId,
      ),
    enabled: open && isHydrated && Boolean(user),
  });

  const title = kind === 'followers' ? 'Followers' : 'Following';
  const myFollowing = new Set(mine.data ?? []);

  let body;
  if (list.isPending) {
    body = (
      <SkeletonGroup label={`Loading ${title.toLowerCase()}`}>
        <RowSkeleton count={5} />
      </SkeletonGroup>
    );
  } else if (list.isError) {
    body = (
      <LoadError
        message={`We couldn’t load ${title.toLowerCase()}.`}
        onRetry={() => void list.refetch()}
      />
    );
  } else if (list.data.length === 0) {
    body = (
      <p className={styles.empty}>
        {kind === 'followers'
          ? 'No followers yet.'
          : 'Not following anyone yet.'}
      </p>
    );
  } else {
    body = (
      <ul className={styles.list}>
        {list.data.map((person) => (
          <li key={person.userId} className={styles.row}>
            <Link
              href={`/profile/${person.userId}`}
              className={styles.person}
              onClick={onClose}
            >
              <Avatar src={person.avatarUrl} name={person.displayName} decorative />
              <span className={styles.names}>
                <span className={styles.displayName}>{person.displayName}</span>
                <span className={styles.username}>@{person.username}</span>
              </span>
            </Link>
            {/* Wait for the viewer's follow list so the button never flickers. */}
            {(mine.isSuccess || !user) && (
              <FollowButton
                userId={person.userId}
                isFollowing={myFollowing.has(person.userId)}
                size="sm"
              />
            )}
          </li>
        ))}
      </ul>
    );
  }

  return (
    <Dialog open={open} onClose={onClose} title={title} size="sm" flush>
      {body}
    </Dialog>
  );
}
