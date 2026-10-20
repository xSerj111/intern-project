import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { FeedCursor } from '../domain/feed-cursor';
import { FeedQueryDto } from './feed-query.dto';

const run = async (query: Record<string, unknown>) => {
  const dto = plainToInstance(FeedQueryDto, query);
  return { dto, errors: await validate(dto, { whitelist: true }) };
};

const messages = (errors: Awaited<ReturnType<typeof validate>>) =>
  errors.flatMap((e) => Object.values(e.constraints ?? {}));

describe('FeedQueryDto', () => {
  it('defaults limit to 20 when absent', async () => {
    const { dto, errors } = await run({});
    expect(errors).toHaveLength(0);
    expect(dto.limit).toBe(20);
    expect(dto.cursor).toBeUndefined();
  });

  it('accepts limit 50 (string, as from a query string)', async () => {
    const { dto, errors } = await run({ limit: '50' });
    expect(errors).toHaveLength(0);
    expect(dto.limit).toBe(50);
  });

  it.each(['0', '-1', 'abc', '1.5', '51', '100000'])(
    'rejects limit %s',
    async (limit) => {
      const { errors } = await run({ limit });
      expect(errors.map((e) => e.property)).toContain('limit');
    },
  );

  it.each(['1', 1, '', 'abc', null])(
    'rejects any page value (%p) with the exact message',
    async (page) => {
      const { errors } = await run({ page });
      expect(messages(errors)).toContain('page is not supported; use cursor');
    },
  );

  it('accepts a well-formed cursor', async () => {
    const cursor = FeedCursor.fromRow({
      t: '2026-03-04T05:06:07.123456Z',
      id: '0b8f3a52-9c1d-4e6a-8f2b-7a1c5d9e3b40',
    }).encode();
    const { errors } = await run({ cursor });
    expect(errors).toHaveLength(0);
  });

  it.each(['garbage', '!!!', 'e30'])(
    'rejects malformed cursor %s with "cursor is invalid"',
    async (cursor) => {
      const { errors } = await run({ cursor });
      expect(messages(errors)).toContain('cursor is invalid');
    },
  );
});
