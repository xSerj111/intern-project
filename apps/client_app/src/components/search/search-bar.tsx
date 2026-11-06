'use client';

import { Search } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';

import { Input } from '../ui/input';

import styles from './search-bar.module.css';

interface SearchBarProps {
  /** `navigate` opens `/search` on submit; `live` edits the query of `/search` in place. */
  mode: 'navigate' | 'live';
}

function searchHref(q: string, tab: string | null): string {
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (tab) params.set('tab', tab);
  const query = params.toString();
  return query ? `/search?${query}` : '/search';
}

/** Search field: submits to `/search` (home) or keeps `?q=` in sync as you type (search page). */
export function SearchBar({ mode }: SearchBarProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlQuery = searchParams.get('q') ?? '';
  const tab = searchParams.get('tab');
  const [text, setText] = useState(mode === 'live' ? urlQuery : '');
  // Last value written to the URL, so our own replace is not echoed back into the field.
  const written = useRef(urlQuery);

  // Follow external URL changes (back/forward, links) in live mode.
  useEffect(() => {
    if (mode !== 'live' || urlQuery === written.current) return;
    written.current = urlQuery;
    setText(urlQuery);
  }, [mode, urlQuery]);

  useEffect(() => {
    if (mode !== 'live') return;
    const timer = setTimeout(() => {
      const q = text.trim();
      if (q === written.current) return;
      written.current = q;
      router.replace(searchHref(q, tab));
    }, 250);
    return () => clearTimeout(timer);
  }, [mode, text, tab, router]);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const q = text.trim();
    if (mode === 'navigate') {
      if (q) router.push(searchHref(q, null));
      return;
    }
    written.current = q;
    router.replace(searchHref(q, tab));
  };

  return (
    <form role="search" className={styles.form} onSubmit={onSubmit}>
      <Search size={18} className={styles.icon} aria-hidden="true" />
      <Input
        type="search"
        name="q"
        aria-label="Search"
        placeholder="Search people, posts and #tags"
        autoComplete="off"
        value={text}
        onChange={(event) => setText(event.target.value)}
        className={styles.input}
      />
    </form>
  );
}
