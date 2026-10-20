import type { CSSProperties, ReactNode } from 'react';

import { cx } from '../../lib/cx';

import styles from './skeleton.module.css';

interface SkeletonProps {
  width?: number | string;
  height?: number | string;
  /** `full` for circles and pills. */
  radius?: 'sm' | 'md' | 'full';
  className?: string;
}

/** Shimmering placeholder block. Decorative: wrap groups in a `status` region. */
export function Skeleton({
  width = '100%',
  height = 14,
  radius = 'sm',
  className,
}: SkeletonProps) {
  const style: CSSProperties = { width, height };
  return (
    <span
      className={cx(styles.skeleton, styles[radius], className)}
      style={style}
      aria-hidden="true"
    />
  );
}

/** Loading region wrapper: announces `label` once, hides the shapes. */
export function SkeletonGroup({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div role="status" aria-live="polite" className={className}>
      <span className="visually-hidden">{label}</span>
      {children}
    </div>
  );
}

/** Placeholder shaped like a feed post card. */
export function PostSkeleton() {
  return (
    <div className={styles.post}>
      <div className={styles.row}>
        <Skeleton width={36} height={36} radius="full" />
        <div className={styles.lines}>
          <Skeleton width="40%" height={12} />
          <Skeleton width="22%" height={10} />
        </div>
      </div>
      <Skeleton height="auto" radius="md" className={styles.media} />
      <div className={styles.lines}>
        <Skeleton width="30%" height={12} />
        <Skeleton width="85%" height={12} />
      </div>
    </div>
  );
}

/** Placeholder shaped like a list row (avatar + two lines). */
export function RowSkeleton({ count = 3 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className={cx(styles.row, styles.listRow)}>
          <Skeleton width={44} height={44} radius="full" />
          <div className={styles.lines}>
            <Skeleton width="45%" height={12} />
            <Skeleton width="70%" height={10} />
          </div>
        </div>
      ))}
    </>
  );
}

/** Placeholder shaped like a profile header. */
export function ProfileHeaderSkeleton() {
  return (
    <div className={styles.profile}>
      <Skeleton width={150} height={150} radius="full" className={styles.profileAvatar} />
      <div className={styles.lines}>
        <Skeleton width="45%" height={20} />
        <Skeleton width="70%" height={14} />
        <Skeleton width="60%" height={14} />
      </div>
    </div>
  );
}
