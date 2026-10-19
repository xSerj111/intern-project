'use client';

import { useRouter } from 'next/navigation';

import type { IPostResponse } from '@repo/contracts';

import { PostComments } from '../comments/post-comments';

import { ImageCarousel, visibleAssets } from './image-carousel';
import { PostActions } from './post-actions';
import { PostHeader } from './post-header';
import { PostMenu } from './post-menu';
import styles from './post-detail.module.css';

/**
 * Full post view. Desktop: photos on the left, header, caption and comments on
 * the right (comments scroll, composer stays pinned). Mobile: stacked.
 */
export function PostDetail({ post }: { post: IPostResponse }) {
  const router = useRouter();
  const hasMedia = visibleAssets(post.assets).length > 0;

  const header = (
    <div className={styles.header}>
      <PostHeader
        post={post}
        actions={<PostMenu post={post} onDeleted={() => router.replace('/')} />}
      />
    </div>
  );

  const caption = post.content ? (
    <p className={styles.caption}>{post.content}</p>
  ) : null;

  return (
    <article
      className={hasMedia ? styles.card : `${styles.card} ${styles.textOnly}`}
    >
      {hasMedia && (
        <div className={styles.media}>
          <ImageCarousel assets={post.assets ?? []} variant="detail" />
        </div>
      )}
      <div className={styles.side}>
        {header}
        <PostComments
          postId={post.id}
          scrollable
          className={styles.comments}
          intro={
            <>
              {caption}
              <div className={styles.actions}>
                <PostActions post={post} commentsHref={null} />
              </div>
            </>
          }
        />
      </div>
    </article>
  );
}
