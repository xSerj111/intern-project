import { Skeleton, SkeletonGroup } from '../ui/skeleton';

import styles from './thread-skeleton.module.css';

const BUBBLES: Array<{ own: boolean; width: string }> = [
  { own: false, width: '55%' },
  { own: false, width: '35%' },
  { own: true, width: '45%' },
  { own: false, width: '60%' },
  { own: true, width: '30%' },
];

/** Placeholder for a thread that is still loading: header, bubbles and composer. */
export function ThreadSkeleton() {
  return (
    <SkeletonGroup label="Loading conversation…" className={styles.root}>
      <div className={styles.header}>
        <Skeleton width={44} height={44} radius="full" />
        <div className={styles.lines}>
          <Skeleton width="35%" height={14} />
          <Skeleton width="20%" height={10} />
        </div>
      </div>
      <div className={styles.body}>
        {BUBBLES.map((bubble, index) => (
          <div
            key={index}
            className={bubble.own ? styles.rowOwn : styles.row}
          >
            <Skeleton width={bubble.width} height={40} radius="md" />
          </div>
        ))}
      </div>
      <div className={styles.composer}>
        <Skeleton height={48} radius="full" />
      </div>
    </SkeletonGroup>
  );
}
