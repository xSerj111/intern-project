import { DomainError } from '@repo/shared';

export class UnsupportedNotificationEventError extends DomainError {
  constructor(eventType: string) {
    super(`Event "${eventType}" does not produce a stored notification.`);
  }
}

export class EmailDeliveryFinalizedError extends DomainError {
  constructor(jobId: string, status: string) {
    super(`Email delivery "${jobId}" is already ${status} and cannot change.`);
  }
}
