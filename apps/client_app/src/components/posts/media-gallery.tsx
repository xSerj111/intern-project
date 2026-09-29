'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import type { IPostMediaResponse } from '@repo/contracts';

import styles from './media-gallery.module.css';

export interface MediaGalleryProps {
  assets: IPostMediaResponse[];
  /** Index of the media to show first. */
  startIndex?: number;
  /** Author handle used in alt text, e.g. `@ada`. */
  authorLabel?: string;
  onClose: () => void;
}

/** Full-screen lightbox with prev/next navigation and video playback. */
export function MediaGallery({
  assets,
  startIndex = 0,
  authorLabel,
  onClose,
}: MediaGalleryProps) {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const touchStartX = useRef<number | null>(null);
  const [index, setIndex] = useState(
    Math.min(Math.max(startIndex, 0), Math.max(assets.length - 1, 0)),
  );

  const goPrev = useCallback(() => {
    setIndex((current) => (current - 1 + assets.length) % assets.length);
  }, [assets.length]);

  const goNext = useCallback(() => {
    setIndex((current) => (current + 1) % assets.length);
  }, [assets.length]);

  // Move focus into the dialog and hand it back to the trigger on close.
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => trigger?.focus?.();
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Tab' && overlayRef.current) {
        const focusable = Array.from(
          overlayRef.current.querySelectorAll<HTMLElement>(
            'button, [href], video[controls], [tabindex]:not([tabindex="-1"])',
          ),
        );
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (!first || !last) return;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowLeft') goPrev();
      if (event.key === 'ArrowRight') goNext();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [goNext, goPrev, onClose]);

  if (assets.length === 0) return null;

  const asset = assets[index];
  const description = `${asset.mediaType === 'video' ? 'Video' : 'Image'} ${index + 1} of ${assets.length}${authorLabel ? ` by ${authorLabel}` : ''}`;

  function onTouchEnd(clientX: number) {
    const start = touchStartX.current;
    touchStartX.current = null;
    if (start === null || assets.length < 2) return;
    const delta = clientX - start;
    if (Math.abs(delta) < 50) return;
    if (delta < 0) goNext();
    else goPrev();
  }

  return (
    <div
      ref={overlayRef}
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-label="Media gallery"
      onClick={onClose}
    >
      <button
        ref={closeRef}
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

      <div
        className={styles.stage}
        data-testid="gallery-stage"
        onClick={(event) => event.stopPropagation()}
        onTouchStart={(event) => {
          touchStartX.current = event.touches[0]?.clientX ?? null;
        }}
        onTouchEnd={(event) => onTouchEnd(event.changedTouches[0]?.clientX ?? 0)}
      >
        {asset.mediaType === 'video' ? (
          <video
            key={asset.assetId}
            src={asset.url}
            className={styles.media}
            controls
            aria-label={description}
            autoPlay
            playsInline
          />
        ) : (
          <img
            key={asset.assetId}
            src={asset.url}
            alt={description}
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
