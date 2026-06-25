import { DomainError } from '@repo/shared';

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
