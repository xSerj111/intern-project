import {
  AccessDeniedError,
  DomainError,
  EntityNotFoundError,
} from '@repo/shared';

export class InvalidDisplayNameError extends DomainError {
  constructor(value: string) {
    super(`Display name "${value}" is invalid: it must be 1–100 characters.`);
  }
}

export class InvalidProfileBioError extends DomainError {
  constructor(length: number) {
    super(`Profile bio is too long: ${length} characters (max 160).`);
  }
}

export class UserNotFoundError extends EntityNotFoundError {
  constructor(userIds: string[]) {
    super('User', { userIds });
  }
}

/** The asset id given for an avatar does not exist (400: it is a bad body value). */
export class AvatarAssetNotFoundError extends DomainError {
  constructor(assetId: string) {
    super(`Avatar asset "${assetId}" was not found.`);
  }
}

/** The asset exists but cannot serve as an avatar (private or not an image). */
export class InvalidAvatarAssetError extends DomainError {
  constructor(reason: string) {
    super(`Asset cannot be used as an avatar: ${reason}.`);
  }
}

/** The asset was uploaded by someone else (403). */
export class AvatarAssetNotOwnedError extends AccessDeniedError {
  constructor() {
    super('You can only use an image you uploaded as your avatar.');
  }
}

/** The caller is not the profile's owner (403). */
export class NotProfileOwnerError extends AccessDeniedError {
  constructor() {
    super('You can only update your profile');
  }
}
