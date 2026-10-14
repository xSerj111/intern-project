import { DomainError } from '@repo/shared';

export class MissingStorageKeyError extends DomainError {
  constructor() {
    super('A private asset requires a storage key.');
  }
}
