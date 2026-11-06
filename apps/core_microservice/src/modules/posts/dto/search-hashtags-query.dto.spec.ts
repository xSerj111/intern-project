import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SearchHashtagsQueryDto } from './search-hashtags-query.dto';

const run = async (query: Record<string, unknown>) => {
  const dto = plainToInstance(SearchHashtagsQueryDto, query);
  return { dto, errors: await validate(dto, { whitelist: true }) };
};

describe('SearchHashtagsQueryDto', () => {
  it('normalizes #Café to café and defaults limit to 10', async () => {
    const { dto, errors } = await run({ q: '#Café' });
    expect(errors).toHaveLength(0);
    expect(dto.q).toBe('café');
    expect(dto.limit).toBe(10);
  });

  it('NFC-normalizes a decomposed q', async () => {
    const { dto, errors } = await run({ q: 'café' });
    expect(errors).toHaveLength(0);
    expect(dto.q).toBe('café');
  });

  it('accepts 50 chars and a limit of 1 or 50 (string)', async () => {
    for (const limit of ['1', '50']) {
      const { dto, errors } = await run({ q: 'a'.repeat(50), limit });
      expect(errors).toHaveLength(0);
      expect(dto.limit).toBe(Number(limit));
    }
  });

  it.each(['a b', 'a-b', '', '#', 'a'.repeat(51), '##a'])(
    'rejects q %j',
    async (q) => {
      const { errors } = await run({ q });
      expect(errors.map((e) => e.property)).toContain('q');
    },
  );

  it('rejects a missing or non-string q', async () => {
    for (const q of [undefined, ['a'], 5]) {
      const { errors } = await run({ q });
      expect(errors.map((e) => e.property)).toContain('q');
    }
  });

  it.each(['0', '51', '-1', 'abc', '1.5'])(
    'rejects limit %s',
    async (limit) => {
      const { errors } = await run({ q: 'a', limit });
      expect(errors.map((e) => e.property)).toContain('limit');
    },
  );
});
