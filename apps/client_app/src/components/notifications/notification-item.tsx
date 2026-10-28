'use client';

import { useQuery } from '@tanstack/react-query';
import { Heart, MessageCircle, UserPlus, type LucideIcon } from 'lucide-react';
import Link from 'next/link';

import type { INotification, NotificationKind } from '@repo/contracts';

import { getProfileSummary, profileKeys } from '../../lib/api/profile';
import { useAuth } from '../../lib/auth/auth-context';
import { cx } from '../../lib/cx';
import { FollowButton } from '../follows/follow-button';
import { Avatar } from '../ui/avatar';
import { Dot } from '../ui/badge';
import { RelativeTime } from '../ui/relative-time';
import { Skeleton } from '../ui/skeleton';

import { NotificationThumb } from './notification-thumb';
import styles from './notification-item.module.css';

interface KindStyle {
  icon: LucideIcon;
  /** CSS-module class colouring the avatar badge. */
  tone: 'like' | 'primary' | 'success';
  /** Solid glyph (only sensible for closed shapes such as the heart). */
  filled?: boolean;
  action: string;
}

const KINDS: Record<NotificationKind, KindStyle> = {
  POST_COMMENTED: {
    icon: MessageCircle,
    tone: 'primary',
    action: 'commented on your post.',
  },
  POST_LIKED: {
    icon: Heart,
    tone: 'like',
    filled: true,
    action: 'liked your post.',
  },
  COMMENT_LIKED: {
    icon: Heart,
    tone: 'like',
    filled: true,
    action: 'liked your comment.',
  },
  USER_FOLLOWED: {
    icon: UserPlus,
    tone: 'success',
    action: 'started following you.',
  },
};

/** The post a notification refers to, if any. */
function notificationPostId(notification: INotification): string | null {
  if (notification.kind === 'USER_FOLLOWED') return null;
  return (
    notification.target.postId ??
    (notification.target.type === 'POST' ? notification.target.id : null)
  );
}

/** In-app route a notification points at: the post, or the actor's profile for follows. */
export function notificationHref(notification: INotification): string {
  const postId = notificationPostId(notification);
  return postId ? `/posts/${postId}` : `/profile/${notification.actor.userId}`;
}

/** Follow-back button; looks up whether the viewer already follows the actor. */
function FollowBack({ userId }: { userId: string }) {
  const { accessToken, isHydrated } = useAuth();
  const query = useQuery({
    queryKey: profileKeys.summary(userId),
    queryFn: ({ signal }) => getProfileSummary(userId, accessToken, signal),
    enabled: isHydrated && Boolean(accessToken),
  });

  if (query.isPending) {
    return <Skeleton width={84} height={32} radius="sm" />;
  }
  if (!query.data) {
    return null;
  }
  return (
    <FollowButton
      userId={userId}
      isFollowing={query.data.isFollowedByMe}
      size="sm"
      followLabel="Follow back"
    />
  );
}

interface NotificationItemProps {
  notification: INotification;
  /** Highlights the item as not yet seen. */
  highlighted: boolean;
}

/**
 * One notification row: actor avatar with a per-kind badge, text, relative
 * time, and a post thumbnail or follow-back button on the right. The whole row
 * links to its target (stretched link); the actor name links to their profile.
 */
export function NotificationItem({
  notification,
  highlighted,
}: NotificationItemProps) {
  const { actor, excerpt, occurredAt, kind } = notification;
  const { icon: KindIcon, tone, filled, action } = KINDS[kind];
  const postId = notificationPostId(notification);
  const href = notificationHref(notification);
  const profileHref = `/profile/${actor.userId}`;
  // For follows the row target and the actor link are the same page.
  const redundantRowLink = href === profileHref;

  return (
    <div className={cx(styles.item, highlighted && styles.unseen)}>
      {redundantRowLink ? (
        <Link
          href={href}
          className={styles.rowLink}
          tabIndex={-1}
          aria-hidden="true"
        />
      ) : (
        <Link href={href} className={styles.rowLink}>
          <span className="visually-hidden">
            View post: {actor.displayName} {action}
          </span>
        </Link>
      )}

      {highlighted && <Dot className={styles.dot} label="Unseen" />}

      <span className={styles.avatar}>
        <Avatar
          src={actor.avatarUrl}
          name={actor.displayName}
          size="md"
          decorative
        />
        <span className={cx(styles.badge, styles[tone])} aria-hidden="true">
          <KindIcon
            size={11}
            strokeWidth={2.5}
            fill={filled ? 'currentColor' : 'none'}
          />
        </span>
      </span>

      <div className={styles.body}>
        <p className={styles.text}>
          <Link href={profileHref} className={styles.actor}>
            {actor.displayName}
          </Link>{' '}
          {action} <RelativeTime value={occurredAt} className={styles.time} />
        </p>
        {excerpt && <p className={styles.excerpt}>{excerpt}</p>}
      </div>

      <div className={styles.aside}>
        {kind === 'USER_FOLLOWED' ? (
          <FollowBack userId={actor.userId} />
        ) : (
          postId && <NotificationThumb postId={postId} />
        )}
      </div>
    </div>
  );
}
