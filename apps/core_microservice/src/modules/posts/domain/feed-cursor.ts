// ISO-8601 UTC with microseconds, as produced by Postgres `to_char(..., 'US')`.
const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Keyset position in the feed order `(createdAt DESC, id DESC)`.
 * `t` is the raw Postgres timestamp text (microseconds), never a JS `Date`:
 * a Date would truncate to milliseconds and skip rows sharing a millisecond.
 */
export class FeedCursor {
  readonly v = 1 as const;

  private constructor(
    readonly t: string,
    readonly id: string,
  ) {}

  static fromRow({ t, id }: { t: string; id: string }): FeedCursor {
    return new FeedCursor(t, id);
  }

  /** Returns `null` for anything that is not a well-formed v1 cursor. */
  static decode(s: unknown): FeedCursor | null {
    if (typeof s !== 'string' || s.length === 0) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));
    } catch {
      return null;
    }
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { v, t, id } = parsed as Record<string, unknown>;
    if (v !== 1) return null;
    if (typeof t !== 'string' || !TIMESTAMP_RE.test(t)) return null;
    if (Number.isNaN(Date.parse(t.slice(0, 23) + 'Z'))) return null;
    if (typeof id !== 'string' || !UUID_RE.test(id)) return null;
    return new FeedCursor(t, id);
  }

  encode(): string {
    return Buffer.from(
      JSON.stringify({ v: this.v, t: this.t, id: this.id }),
      'utf8',
    ).toString('base64url');
  }
}
