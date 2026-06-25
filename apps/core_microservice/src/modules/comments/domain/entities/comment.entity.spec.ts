import { fakeComment } from '../../__tests__/fakers/comment.faker';
import { Comment, EmptyCommentError } from './comment.entity';

describe('Comment', () => {
  describe('create', () => {
    it('builds a top-level comment (no parent)', () => {
      const comment = Comment.create({
        postId: 'post-1',
        authorId: 'author-1',
        content: 'nice',
      });

      expect(comment.content).toBe('nice');
      expect(comment.parentId).toBeUndefined();
    });

    it('keeps the parentId for a reply', () => {
      const comment = Comment.create({
        postId: 'post-1',
        authorId: 'author-1',
        content: 'reply',
        parentId: 'parent-1',
      });

      expect(comment.parentId).toBe('parent-1');
    });
  });

  describe('edit', () => {
    it('updates and trims the content', () => {
      const comment = fakeComment();

      comment.edit('  edited  ');

      expect(comment.content).toBe('edited');
    });

    it('throws EmptyCommentError on blank content', () => {
      expect(() => fakeComment().edit('   ')).toThrow(EmptyCommentError);
    });
  });
});
