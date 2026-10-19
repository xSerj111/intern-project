import type { ReactNode } from 'react';

import { Logo } from '../../components/brand/logo';

import styles from './layout.module.css';

/** Sign-in / sign-up: brand panel beside the form, no app navigation. */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className={styles.layout}>
      <aside className={styles.brandPanel}>
        <Logo />
        <div className={styles.pitch}>
          <h2 className={styles.headline}>
            See everyday moments from the people you follow.
          </h2>
          <p className={styles.tagline}>
            Share photos, chat in real time and never miss a like or a comment.
          </p>
        </div>
        <p className={styles.footnote}>© {new Date().getFullYear()} Innogram</p>
      </aside>
      <main className={styles.formPanel}>{children}</main>
    </div>
  );
}
