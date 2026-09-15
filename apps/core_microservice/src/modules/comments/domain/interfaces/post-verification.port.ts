export const PostVerificationPortKey = Symbol.for('IPostVerificationPort');

export interface IPostVerificationPort {
  verifyPostAccess(userId: string, postId: string): Promise<void>;
}
