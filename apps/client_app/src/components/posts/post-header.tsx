'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';

import { PostStatus, type IPostResponse } from '@repo/contracts';

import { Avatar } from '../ui/avatar';
import { RelativeTime } from '../ui/relative-time';

import styles from './post-header.module.css';

/** Display fallback when the author's profile no longer exists. */
const DELETED_AUTHOR = 'Deleted user';

interface PostHeaderProps {
  post: IPostResponse;
  /** Rendered at the right edge (e.g. the owner menu). */
  actions?: ReactNode;
}

/** Author avatar, name and @handle (linking to the profile), age and owner actions. */
export function PostHeader({ post, actions }: PostHeaderProps) {
  const { author } = post;
  const name = author?.displayName || author?.username || DELETED_AUTHOR;

  const identity = (
    <>
      <Avatar src={author?.avatarUrl} name={name} size="sm" decorative />
      <span className={styles.names}>
        <span className={styles.name}>{name}</span>
        {author && <span className={styles.handle}>@{author.username}</span>}
      </span>
    </>
  );

  return (
    <header className={styles.header}>
      {author ? (
        <Link href={`/profile/${author.userId}`} className={styles.identity}>
          {identity}
        </Link>
      ) : (
        <span className={styles.identity}>{identity}</span>
      )}
      {post.status !== PostStatus.Published && (
        <span className={styles.status}>
          {post.status === PostStatus.Draft ? 'Draft' : 'Archived'}
        </span>
      )}
      <Link href={`/posts/${post.id}`} className={styles.time}>
        <RelativeTime value={post.createdAt} />
      </Link>
      {actions}
    </header>
  );
}
