'use client';

import { Home, RefreshCw, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useEffect } from 'react';

import { Logo } from '../components/brand/logo';
import { Button, buttonClassName } from '../components/ui/button';

// Global styles are not loaded by the root layout when this boundary renders,
// so import them here. The page styles are shared with error.tsx.
import './globals.css';
import styles from './error.module.css';

interface GlobalErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/**
 * Last-resort boundary for failures in the root layout. It replaces the whole
 * document, so it renders its own `<html>` and `<body>`.
 */
export default function GlobalError({ error, reset }: GlobalErrorProps) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body>
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
                className={buttonClassName({
                  variant: 'secondary',
                  size: 'lg',
                })}
              >
                <Home size={18} aria-hidden="true" />
                Back to Home
              </Link>
            </div>
          </div>
        </main>
      </body>
    </html>
  );
}
