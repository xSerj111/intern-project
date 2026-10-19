import type { DefaultEventsMap, Socket } from 'socket.io';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from '@repo/contracts';
import type { AccessTokenVerifier } from '@repo/shared';

/** Per-socket state set by the handshake middleware. */
export interface RealtimeSocketData {
  userId: string;
  sid: string | null;
  jti: string;
  /** Token expiry, seconds since epoch (JWT `exp`). */
  exp: number;
  viewingChatId: string | null;
}

export type RealtimeSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  DefaultEventsMap,
  RealtimeSocketData
>;

/**
 * Socket.IO handshake middleware. Reads the access token from
 * `handshake.auth.token` only: a query-string token would end up in logs.
 */
export function createSocketAuthMiddleware(verifier: AccessTokenVerifier) {
  return (socket: RealtimeSocket, next: (err?: Error) => void): void => {
    const auth = socket.handshake.auth as { token?: unknown } | undefined;
    const token = typeof auth?.token === 'string' ? auth.token : undefined;

    verifier
      .verify(token)
      .then((result) => {
        if (!result.ok) {
          next(
            new Error(
              result.reason === 'unavailable' ? 'unavailable' : 'unauthorized',
            ),
          );
          return;
        }
        const { sub, sid, jti, exp } = result.payload;
        socket.data = {
          userId: sub,
          sid: sid ?? null,
          jti,
          exp,
          viewingChatId: null,
        };
        next();
      })
      .catch(() => next(new Error('unavailable')));
  };
}
