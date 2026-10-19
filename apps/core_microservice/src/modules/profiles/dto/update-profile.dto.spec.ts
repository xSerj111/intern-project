import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateProfileDto } from '@repo/shared';

const UUID = '3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e';
const run = async (body: Record<string, unknown>) => {
  const dto = plainToInstance(UpdateProfileDto, body);
  // same options as the global ValidationPipe in main.ts
  return { dto, errors: await validate(dto, { whitelist: true }) };
};

describe('UpdateProfileDto', () => {
  it('accepts an empty body (partial update)', async () => {
    expect((await run({})).errors).toHaveLength(0);
  });

  it('trims displayName and keeps the new fields (not stripped)', async () => {
    const { dto, errors } = await run({
      displayName: '  Jane  ',
      bio: 'hello',
      avatarAssetId: UUID,
    });
    expect(errors).toHaveLength(0);
    expect(dto).toMatchObject({
      displayName: 'Jane',
      bio: 'hello',
      avatarAssetId: UUID,
    });
  });

  it('accepts null to clear bio and avatar', async () => {
    const { dto, errors } = await run({ bio: null, avatarAssetId: null });
    expect(errors).toHaveLength(0);
    expect(dto).toMatchObject({ bio: null, avatarAssetId: null });
  });

  it.each([
    { displayName: '   ' },
    { displayName: 'a'.repeat(101) },
    { bio: 'a'.repeat(161) },
    { avatarAssetId: 'not-a-uuid' },
  ])('rejects %j', async (body) => {
    expect((await run(body)).errors).not.toHaveLength(0);
  });
});
