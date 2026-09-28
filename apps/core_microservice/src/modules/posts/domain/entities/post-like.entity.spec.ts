import { fakePostLike } from '../../__tests__/fakers/post-like.faker';
import { PostLike } from './post-like.entity';

describe('PostLike', () => {
  describe('create', () => {
    it('builds a like for the given post and user', () => {
      const like = PostLike.create('post-1', 'user-1');

      expect(like.postId).toBe('post-1');
      expect(like.userId).toBe('user-1');
    });

    it('starts active (not soft-deleted)', () => {
      expect(PostLike.create('post-1', 'user-1').deletedAt).toBeUndefined();
    });

    it('produces independent rows so the unique index enforces idempotency', () => {
      const first = PostLike.create('post-1', 'user-1');
      const second = PostLike.create('post-1', 'user-1');

      expect(first).not.toBe(second);
    });
  });

  describe('fake', () => {
    it('defaults to a non-deleted like', () => {
      expect(fakePostLike().deletedAt).toBeUndefined();
    });
  });
});
