'use client';

import { useState, type CSSProperties } from 'react';

import { cx } from '../../lib/cx';

import styles from './avatar.module.css';

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';

/** Diameter in px for each size. */
export const AVATAR_SIZES: Record<AvatarSize, number> = {
  xs: 24,
  sm: 32,
  md: 44,
  lg: 56,
  xl: 96,
  '2xl': 150,
};

interface AvatarProps {
  src?: string | null;
  /** Used for the alt text and the fallback initial. */
  name: string;
  size?: AvatarSize;
  /** Brand-gradient ring, as used for profile headers. */
  ring?: boolean;
  /** Decorative when the name is already shown next to it. */
  decorative?: boolean;
  className?: string;
}

/**
 * Round user picture with an initial-letter fallback (also used when the image
 * fails to load).
 */
export function Avatar({
  src,
  name,
  size = 'md',
  ring = false,
  decorative = false,
  className,
}: AvatarProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const showImage = Boolean(src) && src !== failedSrc;
  const initial = name.trim().charAt(0).toUpperCase() || '?';
  const style = { '--avatar-size': `${AVATAR_SIZES[size]}px` } as CSSProperties;

  const face = showImage ? (
    // Plain <img>: avatar hosts (SeaweedFS, presigned URLs) vary per deployment.
    <img
      src={src!}
      alt={decorative ? '' : name}
      className={styles.image}
      loading="lazy"
      decoding="async"
      onError={() => setFailedSrc(src ?? null)}
    />
  ) : (
    <span
      className={styles.fallback}
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : name}
      aria-hidden={decorative || undefined}
    >
      {initial}
    </span>
  );

  return (
    <span
      className={cx(styles.avatar, ring && styles.ring, className)}
      style={style}
    >
      {face}
    </span>
  );
}
