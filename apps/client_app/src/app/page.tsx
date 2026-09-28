import { Logo } from '../components/brand/logo';
import { FeedTabs } from '../components/feed/feed-tabs';

import styles from './page.module.css';

export default function HomePage() {
  return (
    <main className={`container ${styles.page}`}>
      <section className={styles.hero}>
        <Logo />
        <h1>Welcome to Innogram</h1>
        <p className="muted">Share moments with the people you follow.</p>
      </section>

      <section aria-label="Home feed">
        <h2 className={styles.sectionTitle}>Home feed</h2>
        <FeedTabs />
      </section>
    </main>
  );
}
