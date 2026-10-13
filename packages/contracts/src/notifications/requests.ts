export interface IListNotificationsQuery {
  before?: string; // ISO occurredAt
  limit?: number; // 1-50, default 20
}

export interface IMarkSeenRequest {
  upTo?: string; // ISO occurredAt, default now
}
