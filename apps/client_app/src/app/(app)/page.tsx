import { FeedList } from '../../components/feed/feed-list';

import styles from './page.module.css';

export default function HomePage() {
  return (
    <div className={`container ${styles.page}`}>
      <h1 className="visually-hidden">Home</h1>
      <section aria-label="Home feed">
        <FeedList />
      </section>
    </div>
  );
}
