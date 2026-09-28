import { fakeRepost } from '../../__tests__/fakers/repost.faker';
import { Repost } from './repost.entity';

describe('Repost', () => {
  describe('create', () => {
    it('builds a repost of the original post by an author', () => {
      const repost = Repost.create('post-1', 'user-1');

      expect(repost.originalPostId).toBe('post-1');
      expect(repost.authorId).toBe('user-1');
    });

    it('starts active (not soft-deleted)', () => {
      expect(Repost.create('post-1', 'user-1').deletedAt).toBeUndefined();
    });

    it('produces independent rows so the unique index enforces idempotency', () => {
      const first = Repost.create('post-1', 'user-1');
      const second = Repost.create('post-1', 'user-1');

      expect(first).not.toBe(second);
    });
  });

  describe('soft-delete', () => {
    it('allows un-repost via a soft-delete marker', () => {
      const repost = fakeRepost({ deletedAt: new Date('2026-02-01T00:00:00Z') });

      expect(repost.deletedAt).toBeInstanceOf(Date);
    });
  });
});
