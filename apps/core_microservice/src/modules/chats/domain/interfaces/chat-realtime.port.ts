import type { ServerToClientEvents } from '@repo/contracts';

export const CHAT_REALTIME_PORT = Symbol.for('IChatRealtimePort');

/** Name of a server-to-client realtime event. */
export type ChatRealtimeEvent = keyof ServerToClientEvents;

/** Payload of a server-to-client realtime event (its single argument). */
export type ChatRealtimePayload<E extends ChatRealtimeEvent> = Parameters<
  ServerToClientEvents[E]
>[0];

/**
 * Outbound realtime delivery for chats. Services call it after the DB commit;
 * the Socket.IO gateway is the adapter.
 */
export interface IChatRealtimePort {
  /** Emits to every socket in the `chat:{chatId}` room. */
  emitToChat<E extends ChatRealtimeEvent>(
    chatId: string,
    event: E,
    payload: ChatRealtimePayload<E>,
  ): void;

  /** Emits to every socket of the user (`user:{userId}` room). */
  emitToUser<E extends ChatRealtimeEvent>(
    userId: string,
    event: E,
    payload: ChatRealtimePayload<E>,
  ): void;

  /** Adds all of the user's sockets to the `chat:{chatId}` room. */
  joinUserToChat(userId: string, chatId: string): void;

  /** Removes all of the user's sockets from the `chat:{chatId}` room. */
  removeUserFromChat(userId: string, chatId: string): void;

  /** True when any of the user's sockets currently views the chat. */
  isUserViewingChat(userId: string, chatId: string): boolean;
}
