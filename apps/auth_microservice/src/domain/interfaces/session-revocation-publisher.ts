import type { SessionRevokedEvent } from '@repo/shared';

export interface ISessionRevocationPublisher {
  publish(event: SessionRevokedEvent): Promise<void>;
}
