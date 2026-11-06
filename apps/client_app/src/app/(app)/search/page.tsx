import type { Metadata } from 'next';
import { Suspense } from 'react';

import { SearchBar } from '../../../components/search/search-bar';
import { SearchResults } from '../../../components/search/search-results';

import styles from './page.module.css';

export const metadata: Metadata = { title: 'Search' };

/** Public search: people, posts and hashtags, driven by the `q` / `tab` URL params. */
export default function SearchPage() {
  return (
    <div className={`container ${styles.page}`}>
      <h1 className="visually-hidden">Search</h1>
      <Suspense fallback={null}>
        <div className={styles.bar}>
          <SearchBar mode="live" />
        </div>
        <SearchResults />
      </Suspense>
    </div>
  );
}
