import Link from 'next/link';

import type { INotification } from '@repo/contracts';

import styles from './notification-item.module.css';

const ACTIONS: Record<INotification['kind'], string> = {
  POST_COMMENTED: 'commented on your post',
  POST_LIKED: 'liked your post',
  COMMENT_LIKED: 'liked your comment',
  USER_FOLLOWED: 'started following you',
};

/** In-app route a notification points at: the post, or the actor's profile for follows. */
export function notificationHref(notification: INotification): string {
  if (notification.kind === 'USER_FOLLOWED') {
    return `/profile/${notification.actor.userId}`;
  }
  const postId =
    notification.target.postId ??
    (notification.target.type === 'POST' ? notification.target.id : null);
  return postId ? `/posts/${postId}` : `/profile/${notification.actor.userId}`;
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toDateString() === new Date().toDateString()
    ? date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

interface NotificationItemProps {
  notification: INotification;
  /** Highlights the item as not yet seen. */
  highlighted: boolean;
}

/** One notification row: actor, action, optional excerpt, linking to its target. */
export function NotificationItem({
  notification,
  highlighted,
}: NotificationItemProps) {
  const { actor, excerpt, occurredAt } = notification;

  return (
    <Link
      href={notificationHref(notification)}
      className={`${styles.item} ${highlighted ? styles.unseen : ''}`}
    >
      {actor.avatarUrl ? (
        <img className={styles.avatar} src={actor.avatarUrl} alt="" />
      ) : (
        <span className={styles.avatar} aria-hidden="true">
          {actor.displayName.trim().charAt(0).toUpperCase() || '?'}
        </span>
      )}
      <div className={styles.body}>
        <p className={styles.text}>
          <strong>{actor.displayName}</strong> {ACTIONS[notification.kind]}
        </p>
        {excerpt && <p className={styles.excerpt}>{excerpt}</p>}
        <time className={styles.time} dateTime={occurredAt}>
          {formatTime(occurredAt)}
        </time>
      </div>
      {highlighted && <span className={styles.dot} aria-label="Unseen" />}
    </Link>
  );
}
