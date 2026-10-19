import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PostsByAuthorQueryDto } from '@repo/shared';

const run = async (query: Record<string, unknown>) => {
  const dto = plainToInstance(PostsByAuthorQueryDto, query);
  return { dto, errors: await validate(dto, { whitelist: true }) };
};

describe('PostsByAuthorQueryDto', () => {
  it('defaults to page 1, limit 20, published', async () => {
    const { dto, errors } = await run({});
    expect(errors).toHaveLength(0);
    expect(dto).toMatchObject({ page: 1, limit: 20, status: 'published' });
  });

  it('coerces numeric query strings and accepts each status', async () => {
    for (const status of ['draft', 'published', 'archived']) {
      const { dto, errors } = await run({ page: '2', limit: '50', status });
      expect(errors).toHaveLength(0);
      expect(dto).toMatchObject({ page: 2, limit: 50, status });
    }
  });

  it.each([
    { page: '0' },
    { limit: '0' },
    { limit: '51' },
    { page: 'x' },
    { status: 'deleted' },
  ])('rejects %j', async (query) => {
    expect((await run(query)).errors).not.toHaveLength(0);
  });
});
