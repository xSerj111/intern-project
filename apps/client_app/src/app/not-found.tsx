import Link from 'next/link';

import { Logo } from '../components/brand/logo';

import styles from './not-found.module.css';

export default function NotFound() {
  return (
    <main className={`container ${styles.page}`}>
      <Logo />
      <p className={`muted ${styles.code}`}>404</p>
      <h1>We couldn&apos;t find that page</h1>
      <p className="muted">
        The page you were looking for doesn&apos;t exist or has moved.
      </p>
      <div className={styles.actions}>
        <Link href="/" className="button">
          Back to Home
        </Link>
      </div>
    </main>
  );
}
