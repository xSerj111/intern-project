import { Comment } from '../../domain/entities/comment.entity';

/**
 * Test factory for Comment. Builds a fully-populated entity with sensible
 * defaults; pass `overrides` to vary the fields a given test cares about.
 */
export function fakeComment(overrides: Partial<Comment> = {}): Comment {
  const comment = new Comment();
  Object.assign(comment, {
    id: '00000000-0000-0000-0000-000000000020',
    postId: '00000000-0000-0000-0000-000000000010',
    parentId: undefined,
    authorId: '11111111-1111-1111-1111-111111111111',
    content: 'a faked comment',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  });
  return comment;
}
