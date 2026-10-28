import { FeedCursor } from './feed-cursor';

const T = '2026-03-04T05:06:07.123456Z';
const ID = '0b8f3a52-9c1d-4e6a-8f2b-7a1c5d9e3b40';
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64url');
const raw = (o: unknown) => b64(JSON.stringify(o));

describe('FeedCursor', () => {
  it('round-trips encode -> decode preserving microseconds', () => {
    const decoded = FeedCursor.decode(
      FeedCursor.fromRow({ t: T, id: ID }).encode(),
    );
    expect(decoded).toEqual({ v: 1, t: T, id: ID });
    expect(decoded?.t).toBe(T);
  });

  it('encodes as base64url of {v,t,id}', () => {
    const s = FeedCursor.fromRow({ t: T, id: ID }).encode();
    expect(s).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(JSON.parse(Buffer.from(s, 'base64url').toString('utf8'))).toEqual({
      v: 1,
      t: T,
      id: ID,
    });
  });

  it.each([
    ['empty string', ''],
    ['bad base64', '!!!not base64!!!'],
    ['bad JSON', b64('{nope')],
    ['JSON that is not an object', raw('x')],
    ['null JSON', raw(null)],
    ['v !== 1', raw({ v: 2, t: T, id: ID })],
    ['missing v', raw({ t: T, id: ID })],
    [
      'millisecond-only timestamp',
      raw({ v: 1, t: '2026-03-04T05:06:07.123Z', id: ID }),
    ],
    [
      'timestamp without Z',
      raw({ v: 1, t: '2026-03-04T05:06:07.123456', id: ID }),
    ],
    [
      'non-date timestamp',
      raw({ v: 1, t: '2026-13-45T25:61:61.123456Z', id: ID }),
    ],
    ['non-string timestamp', raw({ v: 1, t: 123, id: ID })],
    ['non-uuid id', raw({ v: 1, t: T, id: 'abc' })],
    ['missing id', raw({ v: 1, t: T })],
  ])('decode returns null for %s', (_name, input) => {
    expect(FeedCursor.decode(input)).toBeNull();
  });

  it('decode returns null for non-string input', () => {
    expect(FeedCursor.decode(undefined)).toBeNull();
    expect(FeedCursor.decode(42)).toBeNull();
  });

  it('decode ignores extra fields', () => {
    expect(FeedCursor.decode(raw({ v: 1, t: T, id: ID, x: 1 }))).toEqual({
      v: 1,
      t: T,
      id: ID,
    });
  });
});
