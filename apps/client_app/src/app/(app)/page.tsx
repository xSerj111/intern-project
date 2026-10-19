import { Logo } from '../../components/brand/logo';
import { FeedList } from '../../components/feed/feed-list';

import styles from './page.module.css';

export default function HomePage() {
  return (
    <div className={`container ${styles.page}`}>
      <section className={styles.hero}>
        <Logo />
        <h1>Welcome to Innogram</h1>
        <p className="muted">Share moments with the people you follow.</p>
      </section>

      <section aria-label="Home feed">
        <h2 className={styles.sectionTitle}>Home feed</h2>
        <FeedList />
      </section>
    </div>
  );
}
