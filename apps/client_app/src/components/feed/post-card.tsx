'use client';

import Link from 'next/link';

import type { IPostMediaResponse, IPostResponse } from '@repo/contracts';

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
}

/** Renders a single post: author, text, media and engagement summary. */
export function PostCard({ post, onMediaSelect }: PostCardProps) {
  const { author, assets } = post;

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

      {post.content && <p className={styles.content}>{post.content}</p>}

      {assets.length > 0 && (
        <ul className={styles.media}>
          {assets.map((asset, index) => (
            <li key={asset.assetId} className={styles.mediaItem}>
              <button
                type="button"
                className={styles.mediaButton}
                onClick={() => onMediaSelect?.(index)}
                aria-label={`Open media ${index + 1} of ${assets.length}`}
              >
                <MediaPreview asset={asset} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <footer className={styles.engagement}>
        <span className={post.likedByMe ? styles.liked : undefined}>
          ♥ {post.likeCount}
        </span>
        <span>💬 {post.commentCount}</span>
        <span>🔁 {post.repostCount}</span>
      </footer>
    </article>
  );
}

function MediaPreview({ asset }: { asset: IPostMediaResponse }) {
  if (asset.mediaType === 'video') {
    return (
      <video
        src={asset.url}
        className={styles.mediaVisual}
        muted
        playsInline
        preload="metadata"
      />
    );
  }
  return <img src={asset.url} alt="" className={styles.mediaVisual} />;
}
