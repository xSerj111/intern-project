import {
  AccessDeniedError,
  DomainError,
  EntityNotFoundError,
} from '@repo/shared';

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

export class InvalidGroupTitleError extends DomainError {
  constructor(length: number, min: number, max: number) {
    super(
      `Group title must be between ${min} and ${max} characters (got ${length}).`,
    );
  }
}

export class InvalidGroupSizeError extends DomainError {
  constructor(size: number, min: number, max: number) {
    super(
      `Group must have between ${min} and ${max} participants (got ${size}).`,
    );
  }
}

export class NotAGroupChatError extends DomainError {
  constructor(chatId: string) {
    super(`Chat ${chatId} is not a group chat.`);
  }
}

export class NotAParticipantError extends DomainError {
  constructor(userId: string) {
    super(`User ${userId} is not a participant of this chat.`);
  }
}

export class NotChatAdminError extends AccessDeniedError {
  constructor() {
    super('Only a chat admin can perform this action.');
  }
}

export class NotMessageAuthorError extends AccessDeniedError {
  constructor() {
    super('Only the author can change this message.');
  }
}

export class MessageAlreadyDeletedError extends DomainError {
  constructor() {
    super('Message has already been deleted.');
  }
}

export class SystemMessageImmutableError extends DomainError {
  constructor() {
    super('System messages cannot be edited or deleted.');
  }
}

export class MessageNotFoundError extends EntityNotFoundError {
  constructor(messageId: string) {
    super('Message', { messageId });
  }
}
