export interface IListNotificationsQuery {
  /**
   * Opaque keyset cursor: pass the previous page's `nextCursor` unchanged.
   * Do not parse or build it. (A bare ISO `occurredAt` is still accepted for
   * legacy clients but is not tie-safe.)
   */
  before?: string;
  limit?: number; // 1-50, default 20
}

export interface IMarkSeenRequest {
  upTo?: string; // ISO occurredAt, default now
}
