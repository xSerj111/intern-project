import { Suspense } from 'react';

import { FeedList } from '../../components/feed/feed-list';
import { SearchBar } from '../../components/search/search-bar';

import styles from './page.module.css';

export default function HomePage() {
  return (
    <div className={`container ${styles.page}`}>
      <h1 className="visually-hidden">Home</h1>
      <div className={styles.search}>
        <Suspense fallback={null}>
          <SearchBar mode="navigate" />
        </Suspense>
      </div>
      <section aria-label="Home feed">
        <FeedList />
      </section>
    </div>
  );
}
