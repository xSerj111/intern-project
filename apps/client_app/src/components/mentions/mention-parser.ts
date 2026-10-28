import { HASHTAG_PATTERN_SOURCE, normalizeHashtag } from '@repo/contracts';

/** Characters allowed inside a handle; usernames come from email local parts. */
const HANDLE = String.raw`[\w.-]*\w`;
const MIN_SEARCH_LENGTH = 2;

export type MentionPart =
  | { type: 'text'; value: string }
  | { type: 'mention'; value: string; username: string }
  | { type: 'hashtag'; value: string; tag: string };

/**
 * Split text into plain runs, `@username` mentions (not `a@b.com`) and
 * `#hashtags`. The text is NFC-normalized first, as core does when it extracts
 * hashtags, so an NFD `#Café` yields the same tag on both sides.
 */
export function splitMentions(raw: string): MentionPart[] {
  const text = raw.normalize('NFC');
  const spans: { start: number; end: number; part: MentionPart }[] = [];

  for (const match of text.matchAll(new RegExp(`@(${HANDLE})`, 'g'))) {
    const start = match.index;
    // `name@host` is an email address, not a mention.
    if (start > 0 && /[\w.-]/.test(text[start - 1])) continue;
    spans.push({
      start,
      end: start + match[0].length,
      part: { type: 'mention', value: match[0], username: match[1] },
    });
  }
  for (const match of text.matchAll(new RegExp(HASHTAG_PATTERN_SOURCE, 'gu'))) {
    spans.push({
      start: match.index,
      end: match.index + match[0].length,
      part: {
        type: 'hashtag',
        value: match[0],
        tag: normalizeHashtag(match[1]),
      },
    });
  }

  spans.sort((a, b) => a.start - b.start);
  const parts: MentionPart[] = [];
  let last = 0;
  for (const span of spans) {
    if (span.start < last) continue; // overlaps an earlier match
    if (span.start > last) {
      parts.push({ type: 'text', value: text.slice(last, span.start) });
    }
    parts.push(span.part);
    last = span.end;
  }
  if (last < text.length) parts.push({ type: 'text', value: text.slice(last) });
  return parts;
}

/** Distinct lowercase usernames the search endpoint can resolve (2-50 chars). */
export function mentionedUsernames(parts: MentionPart[]): string[] {
  const names = new Set<string>();
  for (const part of parts) {
    if (part.type !== 'mention') continue;
    const { username } = part;
    if (username.length >= MIN_SEARCH_LENGTH && username.length <= 50) {
      names.add(username.toLowerCase());
    }
  }
  return [...names];
}

export interface MentionTrigger {
  /** Index of the `@`. */
  start: number;
  /** Caret position (end of the typed query). */
  end: number;
  query: string;
}

/** The `@token` the caret is currently inside, or null. */
export function findMentionAtCaret(
  value: string,
  caret: number,
): MentionTrigger | null {
  const before = value.slice(0, caret);
  const match = /(?:^|[^\w@.-])@([\w.-]*)$/.exec(before);
  if (!match) return null;
  const query = match[1];
  return { start: caret - query.length - 1, end: caret, query };
}

/** Replace the typed `@token` with `@username ` and return the new caret. */
export function insertMention(
  value: string,
  trigger: MentionTrigger,
  username: string,
): { value: string; caret: number } {
  const insert = `@${username} `;
  return {
    value: value.slice(0, trigger.start) + insert + value.slice(trigger.end),
    caret: trigger.start + insert.length,
  };
}

export { MIN_SEARCH_LENGTH };
