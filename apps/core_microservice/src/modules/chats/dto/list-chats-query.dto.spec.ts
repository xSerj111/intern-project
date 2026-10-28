import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ListChatsQueryDto } from './list-chats-query.dto';

const run = async (query: Record<string, unknown>) => {
  const dto = plainToInstance(ListChatsQueryDto, { ...query });
  return { dto, errors: await validate(dto, { whitelist: true }) };
};

describe('ListChatsQueryDto limit', () => {
  it('defaults to 20', async () => {
    const { dto, errors } = await run({});
    expect(errors).toHaveLength(0);
    expect(dto.limit).toBe(20);
  });

  it('accepts the maximum of 50', async () => {
    const { dto, errors } = await run({ limit: '50' });
    expect(errors).toHaveLength(0);
    expect(dto.limit).toBe(50);
  });

  it.each(['0', '-1', 'abc', '1.5', '51'])(
    'rejects limit=%s without clamping',
    async (limit) => {
      const { errors } = await run({ limit });
      expect(errors.map((e) => e.property)).toContain('limit');
    },
  );
});
