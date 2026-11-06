import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { HashtagParamDto } from './hashtag-param.dto';

const run = async (params: Record<string, unknown>) => {
  const dto = plainToInstance(HashtagParamDto, params);
  return { dto, errors: await validate(dto, { whitelist: true }) };
};

describe('HashtagParamDto', () => {
  it('lowercases a plain tag', async () => {
    const { dto, errors } = await run({ tag: 'NestJS' });
    expect(errors).toHaveLength(0);
    expect(dto.tag).toBe('nestjs');
  });

  it('accepts a URL-decoded café', async () => {
    const { dto, errors } = await run({ tag: decodeURIComponent('caf%C3%A9') });
    expect(errors).toHaveLength(0);
    expect(dto.tag).toBe('café');
  });

  it('strips the # of a decoded %23tag', async () => {
    const { dto, errors } = await run({ tag: decodeURIComponent('%23tag') });
    expect(errors).toHaveLength(0);
    expect(dto.tag).toBe('tag');
  });

  it.each(['a b', 'a-b', '', '#', 'a'.repeat(51)])(
    'rejects tag %j',
    async (tag) => {
      const { errors } = await run({ tag });
      expect(errors.map((e) => e.property)).toContain('tag');
    },
  );

  it('rejects a missing tag', async () => {
    const { errors } = await run({});
    expect(errors.map((e) => e.property)).toContain('tag');
  });
});
