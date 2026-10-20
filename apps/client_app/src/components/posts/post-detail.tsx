'use client';

import { X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';

import type { IPostResponse } from '@repo/contracts';

import { PostComments } from '../comments/post-comments';
import { MentionText } from '../mentions/mention-text';
import { IconButton } from '../ui/button';

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

  // Opened from a notification or a pasted link there is nothing to go back to.
  const close = () => {
    if (window.history.length > 1) router.back();
    else router.replace('/');
  };
  const closeRef = useRef(close);
  closeRef.current = close;
  const cardRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Menus handle their own Esc (and preventDefault); open dialogs own it too.
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (document.querySelector('dialog[open]')) return;
      closeRef.current();
    };
    const onClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || !target.isConnected) return;
      if (cardRef.current?.contains(target)) return;
      // Only blank space counts as "outside"; links, buttons and dialogs act normally.
      if (target.closest('a, button, input, textarea, select, dialog')) return;
      closeRef.current();
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('click', onClick);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('click', onClick);
    };
  }, []);

  const header = (
    <div className={styles.header}>
      <PostHeader
        post={post}
        actions={
          <>
            <PostMenu post={post} onDeleted={() => router.replace('/')} />
            <IconButton label="Close" size="sm" onClick={close}>
              <X size={20} />
            </IconButton>
          </>
        }
      />
    </div>
  );

  const caption = post.content ? (
    <p className={styles.caption}>
      <MentionText text={post.content} />
    </p>
  ) : null;

  return (
    <article
      ref={cardRef}
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
