import { UserCreatedEvent, WinstonLogger } from '@repo/shared';
import { env } from '../../config/env';
import { IEventPublisher } from 'src/domain/interfaces/event-publisher.interface';

export class HttpEventPublisher implements IEventPublisher {
  constructor(private readonly logger: WinstonLogger) {}

  publishUserCreatedEvent(payload: UserCreatedEvent): void {
    const coreUrl = env.app.coreMicroserviceUrl || 'http://localhost:3001';
    const url = `${coreUrl}/internal/events/user-created`;

    // Fire-and-forget: celowo brak "await", aby asynchronicznie uwolnić wątek (symulacja kolejki)
    fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
      .then((res) => {
        if (!res.ok) {
          this.logger.warn(`Failed to publish event to Core. Status: ${res.status}`);
        }
      })
      .catch((err) => {
        this.logger.error('Network error while publishing event to Core', { error: err });
      });
  }
}
