import { UserCreatedEvent } from '@repo/shared';

export interface IEventPublisher {
  publishUserCreatedEvent(payload: UserCreatedEvent): void;
}
