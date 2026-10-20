'use client';

import type { MouseEvent } from 'react';
import { useRouter } from 'next/navigation';

import type { IPostResponse } from '@repo/contracts';

import { MentionText } from '../mentions/mention-text';

import { ImageCarousel, visibleAssets } from './image-carousel';
import { PostActions } from './post-actions';
import { PostHeader } from './post-header';
import { PostMenu } from './post-menu';
import styles from './post-card.module.css';

/** One post in a feed or grid: header, text, photos and the action row. */
export function PostCard({ post }: { post: IPostResponse }) {
  const router = useRouter();
  const hasMedia = visibleAssets(post.assets).length > 0;

  // The whole card opens the post; controls and dialogs inside keep their own clicks.
  const open = (event: MouseEvent<HTMLElement>) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest('a, button, input, textarea, select, dialog')) return;
    if (window.getSelection()?.toString()) return;
    router.push(`/posts/${post.id}`);
  };

  return (
    <article
      className={styles.card}
      aria-label={`Post by ${post.author?.displayName ?? 'a deleted user'}`}
      onClick={open}
    >
      <div className={styles.header}>
        <PostHeader post={post} actions={<PostMenu post={post} />} />
      </div>
      {post.content && (
        <p className={styles.content}>
          <MentionText text={post.content} />
        </p>
      )}
      {hasMedia && <ImageCarousel assets={post.assets ?? []} />}
      <div className={styles.footer}>
        <PostActions post={post} />
      </div>
    </article>
  );
}
