import { DomainError } from '@repo/shared';

export class MissingStorageKeyError extends DomainError {
  constructor() {
    super('A private asset requires a storage key.');
  }
}

export class UploadTooLargeError extends DomainError {
  constructor(maxBytes: number) {
    super(`File size must be between 1 and ${maxBytes} bytes.`);
  }
}

export class UploadTypeNotAllowedError extends DomainError {
  constructor(mimeType: string, purpose: string) {
    super(`Content type ${mimeType} is not allowed for ${purpose}.`);
  }
}

export class UploadExpiredError extends DomainError {
  constructor() {
    super('The upload link has expired.');
  }
}

export class UploadNotReadyError extends DomainError {
  constructor() {
    super('The upload has not been confirmed yet.');
  }
}

export class UploadNotPendingError extends DomainError {
  constructor() {
    super('The upload is not pending confirmation.');
  }
}

export class UploadContentRejectedError extends DomainError {
  constructor() {
    super('File content is not an allowed type');
  }
}

export class AssetNotAttachableError extends DomainError {
  constructor(target: string) {
    super(`This asset cannot be attached to a ${target}.`);
  }
}
