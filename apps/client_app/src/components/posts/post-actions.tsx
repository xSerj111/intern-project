'use client';

import Link from 'next/link';
import { useState } from 'react';

import type { IPostResponse } from '@repo/contracts';

import { usePostInteractions } from '../../lib/hooks/use-post-interactions';

import styles from './post-actions.module.css';

/**
 * Like, comment-count, share and re-post actions for a post. Like and re-post
 * update the cached post optimistically and roll back on failure.
 */
export function PostActions({ post }: { post: IPostResponse }) {
  const [shared, setShared] = useState(false);
  const { reposted, toggleLike, toggleRepost, isLikePending, isRepostPending } =
    usePostInteractions(post);

  async function share() {
    const url =
      typeof window === 'undefined'
        ? `/posts/${post.id}`
        : `${window.location.origin}/posts/${post.id}`;

    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ title: 'Innogram post', url });
        return;
      } catch {
        // Fall through to clipboard copy when the share sheet is dismissed.
      }
    }

    try {
      await navigator.clipboard.writeText(url);
      setShared(true);
      window.setTimeout(() => setShared(false), 2000);
    } catch {
      // Clipboard unavailable — nothing else to do.
    }
  }

  return (
    <div className={styles.actions}>
      <button
        type="button"
        className={post.likedByMe ? styles.active : styles.action}
        onClick={toggleLike}
        disabled={isLikePending}
        aria-pressed={post.likedByMe}
      >
        ♥ {post.likeCount}
      </button>

      <Link href={`/posts/${post.id}`} className={styles.action}>
        💬 {post.commentCount}
      </Link>

      <button
        type="button"
        className={reposted ? styles.active : styles.action}
        onClick={toggleRepost}
        disabled={isRepostPending}
        aria-pressed={reposted}
      >
        🔁 {post.repostCount}
      </button>

      <button type="button" className={styles.action} onClick={() => void share()}>
        {shared ? 'Link copied' : 'Share'}
      </button>
    </div>
  );
}
