import {
  INTERNAL_TOKEN_HEADER,
  REQUEST_ID_HEADER,
  UserCreatedEvent,
  WinstonLogger,
  currentRequestId,
} from '@repo/shared';
import { env } from '../../config/env';
import { IEventPublisher } from '../../domain/interfaces/event-publisher.interface';

export class HttpEventPublisher implements IEventPublisher {
  constructor(
    private readonly logger: WinstonLogger,
    // Shared secret for core's internal endpoint; sent as a header, never logged.
    private readonly internalApiToken: string,
  ) {}

  publishUserCreatedEvent(payload: UserCreatedEvent): void {
    const coreUrl = env.app.coreMicroserviceUrl || 'http://localhost:3001';
    const url = `${coreUrl}/internal/events/user-created`;

    // The signup request id travels along so core's logs correlate with auth's.
    const requestId = currentRequestId();

    // Fire-and-forget: deliberately no "await", so the call runs asynchronously (simulates a queue)
    fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [INTERNAL_TOKEN_HEADER]: this.internalApiToken,
        ...(requestId && { [REQUEST_ID_HEADER]: requestId }),
      },
      body: JSON.stringify(payload),
    })
      .then((res) => {
        if (!res.ok) {
          this.logger.warn(`Failed to publish event to Core. Status: ${res.status}`);
        }
      })
      .catch((err: unknown) => {
        const reason = err instanceof Error ? err.message : String(err);
        this.logger.error(`Network error while publishing event to Core: ${reason}`);
      });
  }
}
