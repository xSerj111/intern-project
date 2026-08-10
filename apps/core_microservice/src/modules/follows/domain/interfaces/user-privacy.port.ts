export const UserPrivacyPortKey = Symbol.for('IUserPrivacyPort');

export interface IUserPrivacyPort {
  isUserPrivate(userId: string): Promise<boolean>;
}
