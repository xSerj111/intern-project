import { Repost } from '../../domain/entities/repost.entity';

/**
 * Test factory for Repost. Builds a fully-populated entity with sensible
 * defaults; pass `overrides` to vary the fields a given test cares about.
 */
export function fakeRepost(overrides: Partial<Repost> = {}): Repost {
  const repost = new Repost();
  Object.assign(repost, {
    id: '00000000-0000-0000-0000-000000000030',
    originalPostId: '00000000-0000-0000-0000-000000000010',
    authorId: '11111111-1111-1111-1111-111111111111',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    deletedAt: undefined,
    ...overrides,
  });
  return repost;
}
