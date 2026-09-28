'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';

import type { IPostResponse } from '@repo/contracts';

import { likePost, unlikePost } from '../../lib/api/likes';
import { repostPost, unrepostPost } from '../../lib/api/reposts';
import { useAuth } from '../../lib/auth/auth-context';

import styles from './post-actions.module.css';

/**
 * Like, comment-count, share and re-post actions for a post. Mutations
 * invalidate the feed and post queries so counts/state stay consistent.
 */
export function PostActions({ post }: { post: IPostResponse }) {
  const { accessToken } = useAuth();
  const queryClient = useQueryClient();
  const [shared, setShared] = useState(false);
  const [reposted, setReposted] = useState(false);

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['feed'] });
    void queryClient.invalidateQueries({ queryKey: ['post', post.id] });
  }

  const likeMutation = useMutation({
    mutationFn: () =>
      post.likedByMe
        ? unlikePost(accessToken, post.id)
        : likePost(accessToken, post.id),
    onSuccess: invalidate,
  });

  const repostMutation = useMutation({
    mutationFn: () =>
      reposted
        ? unrepostPost(accessToken, post.id)
        : repostPost(accessToken, post.id),
    onSuccess: () => {
      setReposted((value) => !value);
      invalidate();
    },
  });

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
        onClick={() => likeMutation.mutate()}
        disabled={likeMutation.isPending}
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
        onClick={() => repostMutation.mutate()}
        disabled={repostMutation.isPending}
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
