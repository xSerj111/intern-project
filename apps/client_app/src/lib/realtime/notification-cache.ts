import type {
  INotification,
  INotificationsPage,
  IUnseenCount,
  ServerToClientEvents,
} from '@repo/contracts';
import {
  useQuery,
  type InfiniteData,
  type QueryClient,
} from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';

import { getUnseenCount, notificationKeys } from '../api/notifications';
import { useAuth } from '../auth/auth-context';
import { useConversationList } from './chat-cache';
import type { RealtimeSocket } from './realtime-provider';

/*
 * Notification data in the TanStack Query cache, kept live by socket events
 * (research.md §10).
 *
 * - `notificationKeys.list()`        -> INotificationsPage, or InfiniteData of it
 * - `notificationKeys.unseenCount()` -> IUnseenCount (the bell badge)
 *
 * `chat:alert` only raises a toast. The Messages badge is owned by
 * `message:new` in chat-cache, so one message raises it exactly once.
 * `chat:read` is handled in chat-cache as well and not repeated here.
 */

// ---------------------------------------------------------------------------
// Toasts: a tiny external store so socket handlers can push outside React
// ---------------------------------------------------------------------------

export interface Toast {
  id: string;
  /** "Actor: preview" */
  text: string;
  href: string;
}

const MAX_TOASTS = 3;
const TOAST_TTL_MS = 6000;

let toasts: Toast[] = [];
const toastListeners = new Set<() => void>();
const toastTimers = new Map<string, ReturnType<typeof setTimeout>>();

function emitToasts(next: Toast[]): void {
  toasts = next;
  toastListeners.forEach((listener) => listener());
}

export function dismissToast(id: string): void {
  clearTimeout(toastTimers.get(id));
  toastTimers.delete(id);
  emitToasts(toasts.filter((t) => t.id !== id));
}

export function pushToast(toast: Toast): void {
  if (toasts.some((t) => t.id === toast.id)) {
    return;
  }
  const next = [...toasts, toast];
  const dropped = next.slice(0, Math.max(0, next.length - MAX_TOASTS));
  dropped.forEach((old) => {
    clearTimeout(toastTimers.get(old.id));
    toastTimers.delete(old.id);
  });
  emitToasts(next.slice(dropped.length));
  toastTimers.set(
    toast.id,
    setTimeout(() => dismissToast(toast.id), TOAST_TTL_MS),
  );
}

function subscribeToasts(listener: () => void): () => void {
  toastListeners.add(listener);
  return () => {
    toastListeners.delete(listener);
  };
}

const NO_TOASTS: Toast[] = [];

/** The toasts currently on screen, oldest first. */
export function useToasts(): Toast[] {
  return useSyncExternalStore(
    subscribeToasts,
    () => toasts,
    () => NO_TOASTS,
  );
}

// ---------------------------------------------------------------------------
// Socket handlers
// ---------------------------------------------------------------------------

type NotificationListData =
  INotificationsPage | InfiniteData<INotificationsPage>;

function isInfinite(
  data: NotificationListData,
): data is InfiniteData<INotificationsPage> {
  return 'pages' in data;
}

/** Apply `fn` to every cached page, whichever shape the list query uses. */
function mapListPages(
  client: QueryClient,
  fn: (page: INotificationsPage, index: number) => INotificationsPage,
): void {
  client.setQueryData<NotificationListData>(notificationKeys.list(), (data) => {
    if (!data) {
      return data;
    }
    return isInfinite(data)
      ? { ...data, pages: data.pages.map(fn) }
      : fn(data, 0);
  });
}

/** True when the user is looking at `/messages/{chatId}` in a visible tab. */
function isViewingChat(chatId: string): boolean {
  return (
    typeof document !== 'undefined' &&
    document.visibilityState === 'visible' &&
    window.location.pathname === `/messages/${chatId}`
  );
}

/** `chat:alert`: toast only; the unread badge is `message:new`'s job. */
export function handleChatAlert(
  payload: Parameters<ServerToClientEvents['chat:alert']>[0],
): void {
  if (isViewingChat(payload.chatId)) {
    return;
  }
  pushToast({
    id: payload.messageId,
    text: `${payload.actor.displayName}: ${payload.preview}`,
    href: `/messages/${payload.chatId}`,
  });
}

/** `notification:new`: prepend to the cached list and take the server's count. */
export function handleNotificationNew(
  client: QueryClient,
  payload: { notification: INotification; unseenCount: number },
): void {
  const { notification, unseenCount } = payload;
  mapListPages(client, (page, index) => {
    const items = page.items.filter((n) => n.id !== notification.id);
    return {
      ...page,
      items: index === 0 ? [notification, ...items] : items,
      unseenCount,
    };
  });
  client.setQueryData<IUnseenCount>(notificationKeys.unseenCount(), {
    unseenCount,
  });
}

/**
 * `notifications:seen`: mark cached items seen (only those up to `upTo` when the
 * payload carries it). The event's `unseenCount` is the contract literal 0 even
 * when `upTo` left rows unseen, so the bell count is refetched from the server
 * instead of trusting it.
 */
export function handleNotificationsSeen(
  client: QueryClient,
  payload: { upTo?: string },
): void {
  const limit = payload.upTo ? Date.parse(payload.upTo) : Number.NaN;
  mapListPages(client, (page) => ({
    ...page,
    items: page.items.map((n) =>
      !n.seen && (Number.isNaN(limit) || Date.parse(n.occurredAt) <= limit)
        ? { ...n, seen: true }
        : n,
    ),
  }));
  void client.invalidateQueries({ queryKey: notificationKeys.unseenCount() });
}

/** Attach the notification handlers to `socket`; returns a function that detaches them. */
export function registerNotificationCacheHandlers(
  socket: RealtimeSocket,
  client: QueryClient,
): () => void {
  const onAlert: ServerToClientEvents['chat:alert'] = handleChatAlert;
  const onNew = (payload: {
    notification: INotification;
    unseenCount: number;
  }) => handleNotificationNew(client, payload);
  const onSeen = (payload: { unseenCount: 0; upTo?: string }) =>
    handleNotificationsSeen(client, payload);
  // Notification events missed while offline: take the server's count again.
  const onConnect = () => {
    void client.invalidateQueries({ queryKey: notificationKeys.unseenCount() });
  };

  socket.on('chat:alert', onAlert);
  socket.on('notification:new', onNew);
  socket.on('notifications:seen', onSeen);
  socket.on('connect', onConnect);

  return () => {
    socket.off('chat:alert', onAlert);
    socket.off('notification:new', onNew);
    socket.off('notifications:seen', onSeen);
    socket.off('connect', onConnect);
  };
}

// ---------------------------------------------------------------------------
// Badge hooks
// ---------------------------------------------------------------------------

/** The bell's unseen count, or `undefined` while signed out / not loaded yet. */
export function useUnseenCount(): number | undefined {
  const { accessToken, isHydrated } = useAuth();
  const query = useQuery({
    queryKey: notificationKeys.unseenCount(),
    queryFn: ({ signal }) => getUnseenCount({ token: accessToken, signal }),
    enabled: isHydrated && Boolean(accessToken),
  });
  return query.data?.unseenCount;
}

/** The Messages badge: sum of `unreadCount` across the loaded conversations. */
export function useTotalUnreadCount(): number {
  const list = useConversationList();
  return (list.data?.items ?? []).reduce((sum, c) => sum + c.unreadCount, 0);
}
