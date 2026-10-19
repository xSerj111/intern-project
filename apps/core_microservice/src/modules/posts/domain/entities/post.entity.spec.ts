import { EntityByIdNotFoundError, EXCERPT_MAX_LENGTH } from '@repo/shared';
import { fakePost } from '../../__tests__/fakers/post.faker';
import { InvalidPostStateError, Post, PostStatus } from './post.entity';

describe('Post', () => {
  describe('create', () => {
    it('starts a new post as a draft', () => {
      const post = Post.create({ authorId: 'author-1', content: 'hello' });

      expect(post.status).toBe(PostStatus.Draft);
      expect(post.content).toBe('hello');
    });
  });

  describe('canPublish', () => {
    it('is true for a draft with content', () => {
      expect(
        fakePost({ status: PostStatus.Draft, content: 'x' }).canPublish,
      ).toBe(true);
    });

    it('is false for blank content', () => {
      expect(
        fakePost({ status: PostStatus.Draft, content: '   ' }).canPublish,
      ).toBe(false);
    });

    it('is false when already published', () => {
      expect(fakePost({ status: PostStatus.Published }).canPublish).toBe(false);
    });
  });

  describe('publish', () => {
    it('transitions a draft to published', () => {
      const post = fakePost({ status: PostStatus.Draft, content: 'x' });

      post.publish();

      expect(post.status).toBe(PostStatus.Published);
    });

    it('throws InvalidPostStateError when not publishable', () => {
      expect(() =>
        fakePost({ status: PostStatus.Published }).publish(),
      ).toThrow(InvalidPostStateError);
    });
  });

  describe('assertLikeableBy', () => {
    const AUTHOR = '11111111-1111-1111-1111-111111111111';
    const OTHER = '22222222-2222-2222-2222-222222222222';

    it('passes for a published post, for anyone', () => {
      const post = fakePost({ authorId: AUTHOR, status: PostStatus.Published });

      expect(() => post.assertLikeableBy(OTHER)).not.toThrow();
    });

    it('passes for the author of an unpublished post', () => {
      const draft = fakePost({ authorId: AUTHOR, status: PostStatus.Draft });
      const archived = fakePost({
        authorId: AUTHOR,
        status: PostStatus.Archived,
      });

      expect(() => draft.assertLikeableBy(AUTHOR)).not.toThrow();
      expect(() => archived.assertLikeableBy(AUTHOR)).not.toThrow();
    });

    it('throws not-found for someone else on a draft or archived post', () => {
      const draft = fakePost({ authorId: AUTHOR, status: PostStatus.Draft });
      const archived = fakePost({
        authorId: AUTHOR,
        status: PostStatus.Archived,
      });

      expect(() => draft.assertLikeableBy(OTHER)).toThrow(
        EntityByIdNotFoundError,
      );
      expect(() => archived.assertLikeableBy(OTHER)).toThrow(
        EntityByIdNotFoundError,
      );
    });
  });

  describe('notifiesAuthorOfLikeBy', () => {
    it('is false for the author and true for anyone else', () => {
      const post = fakePost({ authorId: 'author-1' });

      expect(post.notifiesAuthorOfLikeBy('author-1')).toBe(false);
      expect(post.notifiesAuthorOfLikeBy('someone-else')).toBe(true);
    });
  });

  describe('excerpt', () => {
    it('caps the preview at the shared excerpt length', () => {
      const post = fakePost({ content: `  ${'x'.repeat(500)}  ` });

      expect(post.excerpt()).toHaveLength(EXCERPT_MAX_LENGTH);
    });
  });
});
