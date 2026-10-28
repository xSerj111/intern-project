import { Follow } from './follow.entity';

describe('Follow', () => {
  describe('notifiesFollowed', () => {
    it('is true when following someone else', () => {
      const follow = Follow.create({ followerId: 'a', followingId: 'b' });

      expect(follow.notifiesFollowed()).toBe(true);
    });

    it('is false when followerId equals followingId', () => {
      const follow = Follow.create({ followerId: 'a', followingId: 'a' });

      expect(follow.notifiesFollowed()).toBe(false);
    });
  });
});
