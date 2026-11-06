/** Maximum length of one hashtag, without the leading `#`. */
export const HASHTAG_MAX_LENGTH = 50;

/**
 * Source of the regex that finds hashtags in post text. A string rather than a
 * `RegExp` so each caller builds its own `new RegExp(HASHTAG_PATTERN_SOURCE, 'gu')`
 * and no `lastIndex` state is shared.
 *
 * Lookbehind: the `#` must not follow a letter, digit, `_` or `/`. Unicode
 * classes are used because JS `\w` is ASCII-only, so `café#x` is not a tag;
 * `/` so that `example.com/#section` is not a tag.
 *
 * Lookahead: a run longer than 50 characters is not a tag at all, rather than
 * being cut off at 50.
 */
export const HASHTAG_PATTERN_SOURCE =
  '(?<![\\p{L}\\p{N}_/])#([\\p{L}\\p{N}_]{1,50})(?![\\p{L}\\p{N}_])';

/** Validates a single normalized tag (without `#`); use with the `u` flag. */
export const HASHTAG_TAG_PATTERN_SOURCE = '^[\\p{L}\\p{N}_]{1,50}$';

/** Strips one leading `#`, then NFC-normalizes and lowercases. */
export function normalizeHashtag(raw: string): string {
  const tag = raw.startsWith('#') ? raw.slice(1) : raw;
  return tag.normalize('NFC').toLowerCase();
}
