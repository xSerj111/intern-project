'use client';

import type { ServerToClientEvents } from '@repo/contracts';
import { useContext, useEffect, useRef } from 'react';

import { RealtimeContext, type RealtimeSocket } from './realtime-provider';

/** The live realtime socket, or `null` while signed out / before it is created. */
export function useSocket(): RealtimeSocket | null {
  return useContext(RealtimeContext).socket;
}

/** True while the realtime socket is connected. */
export function useSocketConnected(): boolean {
  return useContext(RealtimeContext).isConnected;
}

/**
 * Listen to a server-to-client event for the component's lifetime.
 *
 * The latest `handler` is always called, so it need not be memoized; the
 * listener is re-attached when the socket is recreated (e.g. after re-login).
 */
export function useSocketEvent<E extends keyof ServerToClientEvents>(
  event: E,
  handler: ServerToClientEvents[E],
): void {
  const socket = useSocket();
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    if (!socket) {
      return;
    }
    const listener = ((...args: Parameters<ServerToClientEvents[E]>) => {
      (handlerRef.current as (...a: typeof args) => void)(...args);
    }) as ServerToClientEvents[E];
    socket.on(event, listener as never);
    return () => {
      socket.off(event, listener as never);
    };
  }, [socket, event]);
}
