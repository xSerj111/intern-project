import { DomainError, EntityNotFoundError } from '@repo/shared';

// Also thrown for non-participants so chat existence is not revealed.
export class ChatNotFoundError extends EntityNotFoundError {
  constructor(chatId: string) {
    super('Chat', { chatId });
  }
}

export class CannotChatWithSelfError extends DomainError {
  constructor() {
    super('A chat cannot be created with yourself.');
  }
}

export class EmptyMessageError extends DomainError {
  constructor() {
    super('Message must contain text or at least one attachment.');
  }
}

export class MessageTooLongError extends DomainError {
  constructor(length: number, max: number) {
    super(`Message is too long: ${length} characters (max ${max}).`);
  }
}

export class TooManyAttachmentsError extends DomainError {
  constructor(count: number, max: number) {
    super(`Too many attachments: ${count} (max ${max}).`);
  }
}
