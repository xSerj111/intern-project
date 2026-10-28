'use client';

import { Home, RefreshCw, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useEffect } from 'react';

import { Logo } from '../components/brand/logo';
import { Button, buttonClassName } from '../components/ui/button';

import styles from './error.module.css';

interface ErrorPageProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/**
 * Route-level error boundary. Next.js renders it inside the root layout, so the
 * providers and global styles are still mounted.
 */
export default function ErrorPage({ error, reset }: ErrorPageProps) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className={styles.page}>
      <div className={styles.content}>
        <Link href="/" className={styles.logo} aria-label="Innogram home">
          <Logo />
        </Link>

        <span className={styles.icon} aria-hidden="true">
          <TriangleAlert size={56} strokeWidth={1.5} />
        </span>

        <h1 className={styles.title}>Something went wrong</h1>
        <p className={styles.description}>
          An unexpected error occurred. Try again, or head back home.
        </p>

        <div className={styles.actions}>
          <Button
            size="lg"
            icon={<RefreshCw size={18} aria-hidden="true" />}
            onClick={reset}
          >
            Try again
          </Button>
          <Link
            href="/"
            className={buttonClassName({ variant: 'secondary', size: 'lg' })}
          >
            <Home size={18} aria-hidden="true" />
            Back to Home
          </Link>
        </div>
      </div>
    </main>
  );
}
