'use client';

import { useCallback, useEffect, useState } from 'react';

import type { IPostMediaResponse } from '@repo/contracts';

import styles from './media-gallery.module.css';

export interface MediaGalleryProps {
  assets: IPostMediaResponse[];
  /** Index of the media to show first. */
  startIndex?: number;
  onClose: () => void;
}

/** Full-screen lightbox with prev/next navigation and video playback. */
export function MediaGallery({
  assets,
  startIndex = 0,
  onClose,
}: MediaGalleryProps) {
  const [index, setIndex] = useState(
    Math.min(Math.max(startIndex, 0), Math.max(assets.length - 1, 0)),
  );

  const goPrev = useCallback(() => {
    setIndex((current) => (current - 1 + assets.length) % assets.length);
  }, [assets.length]);

  const goNext = useCallback(() => {
    setIndex((current) => (current + 1) % assets.length);
  }, [assets.length]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowLeft') goPrev();
      if (event.key === 'ArrowRight') goNext();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [goNext, goPrev, onClose]);

  if (assets.length === 0) return null;

  const asset = assets[index];

  return (
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-label="Media gallery"
      onClick={onClose}
    >
      <button
        type="button"
        className={styles.close}
        onClick={onClose}
        aria-label="Close gallery"
      >
        ×
      </button>

      {assets.length > 1 && (
        <button
          type="button"
          className={`${styles.nav} ${styles.prev}`}
          onClick={(event) => {
            event.stopPropagation();
            goPrev();
          }}
          aria-label="Previous media"
        >
          ‹
        </button>
      )}

      <div className={styles.stage} onClick={(event) => event.stopPropagation()}>
        {asset.mediaType === 'video' ? (
          <video
            key={asset.assetId}
            src={asset.url}
            className={styles.media}
            controls
            autoPlay
            playsInline
          />
        ) : (
          <img
            key={asset.assetId}
            src={asset.url}
            alt=""
            className={styles.media}
          />
        )}
      </div>

      {assets.length > 1 && (
        <button
          type="button"
          className={`${styles.nav} ${styles.next}`}
          onClick={(event) => {
            event.stopPropagation();
            goNext();
          }}
          aria-label="Next media"
        >
          ›
        </button>
      )}

      <span className={styles.counter}>
        {index + 1} / {assets.length}
      </span>
    </div>
  );
}
