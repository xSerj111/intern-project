import { ActorSnapshot } from "./event-envelope";
import { NotificationKind } from "./notification.events";

/** Internal to the notifications service (`notifications.email` queue). */
export interface EmailJob {
  /** `${eventId}:${recipientId}` */
  jobId: string;
  recipientId: string;
  kind: NotificationKind | "NEW_MESSAGE";
  actor: ActorSnapshot;
  /** absolute CLIENT_URL deep link */
  link: string;
  /** e.g. "Anna liked your post" */
  summary: string;
  excerpt: string | null;
}
