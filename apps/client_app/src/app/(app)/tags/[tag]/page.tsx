import { HASHTAG_TAG_PATTERN_SOURCE, normalizeHashtag } from '@repo/contracts';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import styles from './page.module.css';
import { TagFeed } from './tag-feed';

type TagPageProps = { params: Promise<{ tag: string }> };

/** Decodes and normalizes the route param; null when malformed or not a valid tag. */
function parseTag(raw: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  const tag = normalizeHashtag(decoded);
  return new RegExp(HASHTAG_TAG_PATTERN_SOURCE, 'u').test(tag) ? tag : null;
}

export async function generateMetadata({
  params,
}: TagPageProps): Promise<Metadata> {
  const tag = parseTag((await params).tag);
  return { title: tag ? `#${tag}` : 'Hashtag' };
}

/** Public feed of posts carrying one hashtag. */
export default async function TagPage({ params }: TagPageProps) {
  const tag = parseTag((await params).tag);
  if (!tag) notFound();

  return (
    <div className={`container ${styles.page}`}>
      <h1 className={styles.title}>#{tag}</h1>
      <section aria-label={`Posts tagged #${tag}`}>
        <TagFeed tag={tag} />
      </section>
    </div>
  );
}
