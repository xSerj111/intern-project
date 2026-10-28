import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ListCommentsQueryDto } from './list-comments-query.dto';

const run = async (query: Record<string, unknown>) => {
  const dto = plainToInstance(ListCommentsQueryDto, query);
  return { dto, errors: await validate(dto, { whitelist: true }) };
};

describe('ListCommentsQueryDto', () => {
  it('defaults to page 1, limit 20', async () => {
    const { dto, errors } = await run({});
    expect(errors).toHaveLength(0);
    expect(dto).toMatchObject({ page: 1, limit: 20 });
  });

  it('coerces numeric query strings and accepts the maximum', async () => {
    const { dto, errors } = await run({ page: '3', limit: '50' });
    expect(errors).toHaveLength(0);
    expect(dto).toMatchObject({ page: 3, limit: 50 });
  });

  it.each([
    { limit: '51' },
    { limit: '0' },
    { limit: '-1' },
    { limit: 'abc' },
    { limit: '1.5' },
    { limit: '' },
    { page: '0' },
    { page: 'abc' },
  ])('rejects %j (never clamps)', async (query) => {
    expect((await run(query)).errors).not.toHaveLength(0);
  });

  it('reports the max-limit message', async () => {
    const { errors } = await run({ limit: '51' });
    expect(Object.values(errors[0].constraints ?? {})).toContain(
      'limit must not be greater than 50',
    );
  });
});
