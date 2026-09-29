'use client';

import Link from 'next/link';
import { useState } from 'react';

import type { IPostMediaResponse, IPostResponse } from '@repo/contracts';

import { PostActions } from '../posts/post-actions';
import { MediaGallery } from '../posts/media-gallery';
import styles from './post-card.module.css';

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function initials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '?';
  return trimmed
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export interface PostCardProps {
  post: IPostResponse;
  /** Optional: open the media gallery at the clicked index (US5). */
  onMediaSelect?: (index: number) => void;
  /** Hide the like/comment/repost summary footer (e.g. when `PostActions` renders it). */
  showEngagement?: boolean;
  /** Highlights case-insensitive matches of this text in the post content. */
  highlight?: string;
}

/** Renders a single post: author, text, media and engagement summary. */
export function PostCard({
  post,
  onMediaSelect,
  showEngagement = true,
  highlight,
}: PostCardProps) {
  const { author, assets } = post;
  const [galleryIndex, setGalleryIndex] = useState<number | null>(null);

  const openMedia = (index: number) => {
    if (onMediaSelect) {
      onMediaSelect(index);
      return;
    }
    setGalleryIndex(index);
  };

  return (
    <article className={styles.card}>
      <header className={styles.header}>
        <span className={styles.avatar} aria-hidden="true">
          {author.avatarUrl ? (
            <img src={author.avatarUrl} alt="" className={styles.avatarImage} />
          ) : (
            initials(author.displayName || author.username)
          )}
        </span>
        <div className={styles.authorBlock}>
          <Link href={`/posts/${post.id}`} className={styles.authorName}>
            {author.displayName || author.username}
          </Link>
          <span className={`muted ${styles.handle}`}>@{author.username}</span>
        </div>
        <time className={styles.time} dateTime={post.createdAt}>
          {formatDate(post.createdAt)}
        </time>
      </header>

      {post.content && (
        <p className={styles.content}>
          <Highlighted text={post.content} term={highlight} />
        </p>
      )}

      {assets.length > 0 && (
        <ul
          className={`${styles.media} ${styles[`media${Math.min(assets.length, 4)}`] ?? ''}`}
        >
          {assets.map((asset, index) => (
            <li key={asset.assetId} className={styles.mediaItem}>
              <button
                type="button"
                className={styles.mediaButton}
                onClick={() => openMedia(index)}
                aria-label={`Open media ${index + 1} of ${assets.length}`}
              >
                <MediaPreview
                  asset={asset}
                  description={`${asset.mediaType === 'video' ? 'Video' : 'Image'} ${index + 1} of ${assets.length} by @${author.username}`}
                />
              </button>
            </li>
          ))}
        </ul>
      )}

      {galleryIndex !== null && (
        <MediaGallery
          assets={assets}
          startIndex={galleryIndex}
          authorLabel={`@${author.username}`}
          onClose={() => setGalleryIndex(null)}
        />
      )}

      {showEngagement && (
        <footer className={styles.engagement}>
          <PostActions post={post} />
        </footer>
      )}
    </article>
  );
}

function MediaPreview({
  asset,
  description,
}: {
  asset: IPostMediaResponse;
  description: string;
}) {
  if (asset.mediaType === 'video') {
    return (
      <video
        src={asset.url}
        className={styles.mediaVisual}
        muted
        playsInline
        preload="metadata"
        aria-label={description}
      />
    );
  }
  return <img src={asset.url} alt={description} className={styles.mediaVisual} />;
}

function Highlighted({ text, term }: { text: string; term?: string }) {
  const needle = term?.trim();
  if (!needle) return <>{text}</>;

  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = text.split(new RegExp(`(${escaped})`, 'i'));
  return (
    <>
      {parts.map((part, index) =>
        part.toLowerCase() === needle.toLowerCase() ? (
          <mark key={index}>{part}</mark>
        ) : (
          part
        ),
      )}
    </>
  );
}
