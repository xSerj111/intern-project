import { HASHTAG_PATTERN_SOURCE, normalizeHashtag } from '@repo/contracts';

/** A post keeps at most this many distinct hashtags; later ones are ignored. */
export const MAX_HASHTAGS_PER_POST = 20;

/**
 * Normalized, distinct hashtags of `content` in order of first appearance,
 * capped at `MAX_HASHTAGS_PER_POST`. The content is NFC-normalized first: in
 * NFD a combining accent is not a letter, so it would end the tag early.
 */
export function extractHashtags(content: string): string[] {
  const pattern = new RegExp(HASHTAG_PATTERN_SOURCE, 'gu');
  const tags = new Set<string>();

  for (const match of content.normalize('NFC').matchAll(pattern)) {
    tags.add(normalizeHashtag(match[1]));
    if (tags.size >= MAX_HASHTAGS_PER_POST) break;
  }
  return [...tags];
}
