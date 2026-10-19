import type {
  IListNotificationsQuery,
  IMarkSeenRequest,
  INotificationPreferences,
  INotificationsPage,
  IUnseenCount,
} from '@repo/contracts';

import { notificationsRequest } from './client';

/** TanStack Query key factories for notification data. */
export const notificationKeys = {
  all: ['notifications'] as const,
  list: () => [...notificationKeys.all, 'list'] as const,
  unseenCount: () => [...notificationKeys.all, 'unseen-count'] as const,
  preferences: () => [...notificationKeys.all, 'preferences'] as const,
};

interface Auth {
  token?: string | null;
  signal?: AbortSignal;
}

/** Newest-first page of the caller's notifications (`GET /notifications`), cursor = `before`. */
export function listNotifications(
  query: IListNotificationsQuery = {},
  { token, signal }: Auth = {},
): Promise<INotificationsPage> {
  return notificationsRequest<INotificationsPage>('/notifications', {
    token,
    signal,
    query: { ...query },
  });
}

/** Unseen badge count (`GET /notifications/unseen-count`). */
export function getUnseenCount({
  token,
  signal,
}: Auth = {}): Promise<IUnseenCount> {
  return notificationsRequest<IUnseenCount>('/notifications/unseen-count', {
    token,
    signal,
  });
}

/** Mark notifications at or before `upTo` (default now) as seen (`POST /notifications/seen`). */
export function markSeen(
  body: IMarkSeenRequest = {},
  { token, signal }: Auth = {},
): Promise<IUnseenCount> {
  return notificationsRequest<IUnseenCount>('/notifications/seen', {
    method: 'POST',
    token,
    signal,
    body,
  });
}

/** Email preferences (`GET /notifications/preferences`). */
export function getPreferences({
  token,
  signal,
}: Auth = {}): Promise<INotificationPreferences> {
  return notificationsRequest<INotificationPreferences>(
    '/notifications/preferences',
    { token, signal },
  );
}

/** Replace email preferences (`PUT /notifications/preferences`, all four flags required). */
export function updatePreferences(
  body: INotificationPreferences,
  { token, signal }: Auth = {},
): Promise<INotificationPreferences> {
  return notificationsRequest<INotificationPreferences>(
    '/notifications/preferences',
    { method: 'PUT', token, signal, body },
  );
}
