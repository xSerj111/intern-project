import { ArgumentsHost, Catch, ExceptionFilter, Logger } from '@nestjs/common';
import type { IRealtimeAckError } from '@repo/contracts';
import { DomainError } from '@repo/shared';

/**
 * Turns a `DomainError` thrown by a socket handler into an ack
 * `{ ok: false, error: { code, message } }`. Anything else is logged and
 * answered with a generic error so the client's ack doesn't hang.
 */
@Catch()
export class WsDomainExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ChatsGateway');

  catch(exception: unknown, host: ArgumentsHost): void {
    // Socket.IO handler args: [client, data, ack?, pattern].
    const ack = host
      .getArgs()
      .slice(2)
      .find(
        (arg): arg is (res: IRealtimeAckError) => void =>
          typeof arg === 'function',
      );

    if (exception instanceof DomainError) {
      ack?.({
        ok: false,
        error: { code: exception.constructor.name, message: exception.message },
      });
      return;
    }

    this.logger.error(
      'Unhandled realtime handler error',
      exception instanceof Error ? exception.stack : String(exception),
    );
    ack?.({
      ok: false,
      error: { code: 'InternalError', message: 'Internal server error' },
    });
  }
}
