'use client';

import type { IPostResponse } from '@repo/contracts';

import { ImageCarousel, visibleAssets } from './image-carousel';
import { PostActions } from './post-actions';
import { PostHeader } from './post-header';
import { PostMenu } from './post-menu';
import styles from './post-card.module.css';

/** One post in a feed or grid: header, text, photos and the action row. */
export function PostCard({ post }: { post: IPostResponse }) {
  const hasMedia = visibleAssets(post.assets).length > 0;

  return (
    <article className={styles.card} aria-label={`Post by ${post.author?.displayName ?? 'a deleted user'}`}>
      <div className={styles.header}>
        <PostHeader post={post} actions={<PostMenu post={post} />} />
      </div>
      {post.content && <p className={styles.content}>{post.content}</p>}
      {hasMedia && <ImageCarousel assets={post.assets ?? []} />}
      <div className={styles.footer}>
        <PostActions post={post} />
      </div>
    </article>
  );
}
