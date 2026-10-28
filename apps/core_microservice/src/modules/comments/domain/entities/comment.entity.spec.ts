import { EntityByIdNotFoundError } from '@repo/shared';
import { fakePost } from '../../../posts/__tests__/fakers';
import type { Post } from '../../../posts/domain/entities/post.entity';
import { fakeComment } from '../../__tests__/fakers/comment.faker';
import { Comment, EmptyCommentError } from './comment.entity';

const AUTHOR = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';

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

  describe('assertLikeableBy', () => {
    const postWith = (assertLikeableBy: jest.Mock) =>
      ({ assertLikeableBy }) as unknown as Post;

    it('delegates to the post for a live comment', () => {
      const assertLikeableBy = jest.fn();

      fakeComment().assertLikeableBy(OTHER, postWith(assertLikeableBy));

      expect(assertLikeableBy).toHaveBeenCalledWith(OTHER);
    });

    it('propagates the post error when the post is not visible', () => {
      const post = postWith(
        jest.fn(() => {
          throw new EntityByIdNotFoundError('Post', 'p');
        }),
      );

      expect(() => fakeComment().assertLikeableBy(OTHER, post)).toThrow(
        EntityByIdNotFoundError,
      );
    });

    it('throws not-found for a soft-deleted comment without asking the post', () => {
      const assertLikeableBy = jest.fn();
      const comment = fakeComment({ deletedAt: new Date() });

      expect(() =>
        comment.assertLikeableBy(OTHER, postWith(assertLikeableBy)),
      ).toThrow(EntityByIdNotFoundError);
      expect(assertLikeableBy).not.toHaveBeenCalled();
    });
  });

  describe('notifiesAuthorOfLikeBy', () => {
    it('is false for a self-like', () => {
      expect(
        fakeComment({ authorId: AUTHOR }).notifiesAuthorOfLikeBy(AUTHOR),
      ).toBe(false);
    });

    it('is true for a like by someone else', () => {
      expect(
        fakeComment({ authorId: AUTHOR }).notifiesAuthorOfLikeBy(OTHER),
      ).toBe(true);
    });
  });

  describe('notifiesPostAuthor', () => {
    const post = fakePost({ authorId: AUTHOR });

    it('is true for a top-level comment by someone else', () => {
      expect(fakeComment({ authorId: OTHER }).notifiesPostAuthor(post)).toBe(
        true,
      );
    });

    it('is false when the commenter is the post author', () => {
      expect(fakeComment({ authorId: AUTHOR }).notifiesPostAuthor(post)).toBe(
        false,
      );
    });

    it('is false for a reply', () => {
      const reply = fakeComment({ authorId: OTHER, parentId: 'parent-1' });

      expect(reply.notifiesPostAuthor(post)).toBe(false);
    });
  });

  describe('excerpt', () => {
    it('caps the preview at 140 characters', () => {
      expect(fakeComment({ content: 'x'.repeat(300) }).excerpt()).toHaveLength(
        140,
      );
    });

    it('trims short content', () => {
      expect(fakeComment({ content: '  hi  ' }).excerpt()).toBe('hi');
    });
  });
});
