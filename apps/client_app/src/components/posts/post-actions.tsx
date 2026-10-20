'use client';

import { Check, MessageCircle, Share2 } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import type { IPostResponse } from '@repo/contracts';

import { formatCount } from '../../lib/format/time';
import { LikeButton } from '../likes/like-button';
import { IconButton } from '../ui/button';

import styles from './post-actions.module.css';

type ShareState = 'idle' | 'copied' | 'failed';

interface PostActionsProps {
  post: IPostResponse;
  /** Link target of the comment button (default: the post page); `null` renders a plain count. */
  commentsHref?: string | null;
}

/** Like, comment (links to the post) and share (copies the link) buttons with counts. */
export function PostActions({ post, commentsHref }: PostActionsProps) {
  const [share, setShare] = useState<ShareState>('idle');
  const timer = useRef<number | undefined>(undefined);
  const href = commentsHref === undefined ? `/posts/${post.id}` : commentsHref;

  useEffect(() => () => window.clearTimeout(timer.current), []);

  async function copyLink() {
    let next: ShareState = 'copied';
    try {
      await navigator.clipboard.writeText(
        `${window.location.origin}/posts/${post.id}`,
      );
    } catch {
      next = 'failed';
    }
    setShare(next);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setShare('idle'), 2000);
  }

  const commentContent = (
    <>
      <MessageCircle size={24} strokeWidth={1.75} aria-hidden="true" />
      {post.commentCount > 0 && (
        <span className={styles.count} aria-hidden="true">
          {formatCount(post.commentCount)}
        </span>
      )}
    </>
  );
  const commentLabel = `Comments (${post.commentCount})`;

  return (
    <div className={styles.row}>
      <LikeButton
        target="post"
        targetId={post.id}
        initialLiked={post.likedByMe}
        initialCount={post.likeCount}
      />
      {href ? (
        <Link href={href} className={styles.comment} aria-label={commentLabel}>
          {commentContent}
        </Link>
      ) : (
        <span className={styles.comment} role="img" aria-label={commentLabel}>
          {commentContent}
        </span>
      )}
      <span className={styles.share}>
        {share !== 'idle' && (
          <span className={styles.feedback} role="status">
            {share === 'copied' ? 'Link copied' : "Couldn't copy"}
          </span>
        )}
        <IconButton label="Copy link to post" onClick={() => void copyLink()}>
          {share === 'copied' ? (
            <Check size={22} />
          ) : (
            <Share2 size={22} strokeWidth={1.75} />
          )}
        </IconButton>
      </span>
    </div>
  );
}
