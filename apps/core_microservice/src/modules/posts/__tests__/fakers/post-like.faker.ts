import { PostLike } from '../../domain/entities/post-like.entity';

/**
 * Test factory for PostLike. Builds a fully-populated entity with sensible
 * defaults; pass `overrides` to vary the fields a given test cares about.
 */
export function fakePostLike(overrides: Partial<PostLike> = {}): PostLike {
  const like = new PostLike();
  Object.assign(like, {
    id: '00000000-0000-0000-0000-000000000020',
    postId: '00000000-0000-0000-0000-000000000010',
    userId: '11111111-1111-1111-1111-111111111111',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    deletedAt: undefined,
    ...overrides,
  });
  return like;
}
