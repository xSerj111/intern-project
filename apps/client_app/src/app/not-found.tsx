import { Compass, Home } from 'lucide-react';
import Link from 'next/link';

import { Logo } from '../components/brand/logo';
import { buttonClassName } from '../components/ui/button';

import styles from './not-found.module.css';

export default function NotFound() {
  return (
    <main className={styles.page}>
      <div className={styles.content}>
        <Link href="/" className={styles.logo} aria-label="Innogram home">
          <Logo />
        </Link>

        <div className={styles.illustration} aria-hidden="true">
          <span className={styles.digit}>4</span>
          <span className={styles.compass}>
            <Compass size={56} strokeWidth={1.5} />
          </span>
          <span className={styles.digit}>4</span>
        </div>

        <h1 className={styles.title}>We couldn&apos;t find that page</h1>
        <p className={styles.description}>
          The link may be broken, or the page may have been removed or moved.
        </p>

        <Link href="/" className={buttonClassName({ size: 'lg' })}>
          <Home size={18} aria-hidden="true" />
          Back to Home
        </Link>
      </div>
    </main>
  );
}
