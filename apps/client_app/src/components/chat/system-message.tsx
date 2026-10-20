import type { IMessage } from '@repo/contracts';

import { formatClock } from '../../lib/format/time';

import styles from './system-message.module.css';

/** Resolves an auth user id to a display name; `undefined` when unknown (e.g. left the group). */
export type UserNameLookup = (userId: string) => string | undefined;

interface SystemMessageProps {
  message: IMessage;
  currentUserId: string | undefined;
  /** Display names of known participants; unknown ids render as "Someone". */
  nameOf: UserNameLookup;
}

function formatNames(names: string[]): string {
  if (names.length <= 1) {
    return names[0] ?? 'someone';
  }
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

/** The sentence for a `SYSTEM` message, or `null` when it carries no event. */
export function describeSystemEvent(
  message: IMessage,
  currentUserId: string | undefined,
  nameOf: UserNameLookup,
): string | null {
  const event = message.systemEvent;
  if (!event) {
    return null;
  }
  const name = (id: string) =>
    id === currentUserId ? 'You' : (nameOf(id) ?? 'Someone');
  const actor = name(event.actorId);
  const targets = formatNames((event.targetUserIds ?? []).map(name));
  const own = event.actorId === currentUserId;

  switch (event.type) {
    case 'group_created':
      return `${actor} created the group`;
    case 'member_added':
      return `${actor} added ${targets}`;
    case 'member_removed':
      return `${actor} removed ${targets}`;
    case 'member_left':
      return `${actor} left`;
    case 'admin_promoted': {
      const target = event.targetUserIds?.[0] ?? event.actorId;
      return `${name(target)} ${target === currentUserId ? 'are' : 'is'} now an admin`;
    }
    case 'group_renamed':
      return `${actor} renamed the group to “${event.title ?? ''}”`;
    default:
      return own ? 'You updated the group' : 'Group update';
  }
}

/** A centered, muted line for a group event ("A added D", "B left", ...). */
export function SystemMessage({
  message,
  currentUserId,
  nameOf,
}: SystemMessageProps) {
  const text =
    describeSystemEvent(message, currentUserId, nameOf) ?? 'Group update';
  return (
    <p className={styles.system}>
      <span>{text}</span>
      <time className={styles.time} dateTime={message.createdAt}>
        {formatClock(message.createdAt)}
      </time>
    </p>
  );
}
