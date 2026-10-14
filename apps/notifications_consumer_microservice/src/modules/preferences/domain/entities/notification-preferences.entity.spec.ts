import { NotificationPreferences } from './notification-preferences.entity';

const USER = '11111111-1111-1111-1111-111111111111';

describe('NotificationPreferences', () => {
  it('defaults(userId) has all four switches on', () => {
    const prefs = NotificationPreferences.defaults(USER);
    expect(prefs.userId).toBe(USER);
    expect(prefs.emailMessages).toBe(true);
    expect(prefs.emailComments).toBe(true);
    expect(prefs.emailLikes).toBe(true);
    expect(prefs.emailFollows).toBe(true);
  });

  describe('allowsEmailFor', () => {
    const allOff = () => {
      const prefs = NotificationPreferences.defaults(USER);
      prefs.update({
        emailMessages: false,
        emailComments: false,
        emailLikes: false,
        emailFollows: false,
      });
      return prefs;
    };

    it.each([
      ['NEW_MESSAGE', 'emailMessages'],
      ['POST_COMMENTED', 'emailComments'],
      ['POST_LIKED', 'emailLikes'],
      ['COMMENT_LIKED', 'emailLikes'],
      ['USER_FOLLOWED', 'emailFollows'],
    ] as const)('maps %s to %s', (kind, field) => {
      const prefs = allOff();
      expect(prefs.allowsEmailFor(kind)).toBe(false);
      prefs.update({ [field]: true });
      expect(prefs.allowsEmailFor(kind)).toBe(true);
    });
  });

  describe('update', () => {
    it('changes only the supplied switches', () => {
      const prefs = NotificationPreferences.defaults(USER);
      prefs.update({ emailLikes: false });
      expect(prefs.emailLikes).toBe(false);
      expect(prefs.emailMessages).toBe(true);
      expect(prefs.emailComments).toBe(true);
      expect(prefs.emailFollows).toBe(true);
    });
  });
});
