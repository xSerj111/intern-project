import Link from 'next/link';

import type { IChatUser } from '@repo/contracts';

import { Avatar } from '../ui/avatar';

import styles from './profile-row.module.css';

/** Search result row linking to a user's profile. */
export function ProfileRow({ user }: { user: IChatUser }) {
  return (
    <Link href={`/profile/${user.userId}`} className={styles.row}>
      <Avatar
        src={user.avatarUrl}
        name={user.displayName}
        size="md"
        decorative
      />
      <span className={styles.text}>
        <span className={styles.name}>{user.displayName}</span>
        <span className={styles.username}>@{user.username}</span>
      </span>
    </Link>
  );
}
