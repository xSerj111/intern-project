import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { MessageChangesQueryDto } from './message-changes-query.dto';

const run = async (query: Record<string, unknown>) => {
  const dto = plainToInstance(MessageChangesQueryDto, {
    afterChangeSeq: '0',
    ...query,
  });
  return { dto, errors: await validate(dto, { whitelist: true }) };
};

describe('MessageChangesQueryDto limit', () => {
  it('defaults to 200', async () => {
    const { dto, errors } = await run({});
    expect(errors).toHaveLength(0);
    expect(dto.limit).toBe(200);
  });

  it('accepts the maximum of 200', async () => {
    const { dto, errors } = await run({ limit: '200' });
    expect(errors).toHaveLength(0);
    expect(dto.limit).toBe(200);
  });

  it.each(['0', '-1', 'abc', '1.5', '201'])(
    'rejects limit=%s without clamping',
    async (limit) => {
      const { errors } = await run({ limit });
      expect(errors.map((e) => e.property)).toContain('limit');
    },
  );
});
