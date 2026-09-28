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
});
