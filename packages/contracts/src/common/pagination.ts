/** Maximum `limit` for offset-paginated list endpoints (out of range → 400, never clamped). */
export const PAGE_SIZE_MAX = 50;

/** Maximum `limit` for the message changes feed (`GET /chats/:chatId/messages/changes`). */
export const CHANGES_PAGE_SIZE_MAX = 200;

/**
 * Offset-paginated list envelope. `hasMore` is computed by fetching `limit + 1`
 * rows, so no COUNT query is needed.
 */
export interface IOffsetPage<T> {
  items: T[];
  page: number;
  limit: number;
  hasMore: boolean;
}
