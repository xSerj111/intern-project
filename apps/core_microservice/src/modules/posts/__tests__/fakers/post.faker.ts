import { Post, PostStatus } from '../../domain/entities/post.entity';

/**
 * Test factory for Post. Builds a fully-populated entity with sensible defaults;
 * pass `overrides` to vary the fields a given test cares about.
 */
export function fakePost(overrides: Partial<Post> = {}): Post {
  const post = new Post();
  Object.assign(post, {
    id: '00000000-0000-0000-0000-000000000010',
    authorId: '11111111-1111-1111-1111-111111111111',
    content: 'a faked post',
    status: PostStatus.Draft,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  });
  return post;
}
