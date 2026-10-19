'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';

import {
  ErrorState,
  LoadingState,
} from '../../../components/common/async-state';
import { getUsersByIds } from '../../../lib/api/profile';
import { ApiError } from '../../../lib/api/client';
import { useAuth } from '../../../lib/auth/auth-context';

import styles from './page.module.css';

const UNAVAILABLE = 'This content is no longer available';

/** Minimal public profile for an auth user id (notification link target). */
export default function UserProfilePage() {
  const { userId } = useParams<{ userId: string }>();
  const { accessToken, isHydrated, isSignedIn } = useAuth();

  const query = useQuery({
    queryKey: ['profile', 'by-user', userId],
    queryFn: async ({ signal }) => {
      try {
        const [user] = await getUsersByIds([userId], accessToken, signal);
        return user ?? null;
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) {
          return null;
        }
        throw error;
      }
    },
    enabled: isHydrated && Boolean(accessToken),
  });

  let content;
  if (!isHydrated || (isSignedIn && query.isPending)) {
    content = <LoadingState label="Loading profile…" />;
  } else if (!isSignedIn) {
    content = (
      <div>
        <p className="muted">Sign in to view this profile.</p>
        <Link href="/login" className="button">
          Sign in
        </Link>
      </div>
    );
  } else if (query.isError) {
    content = (
      <ErrorState
        message="We couldn't load this profile."
        onRetry={() => void query.refetch()}
      />
    );
  } else if (!query.data) {
    content = <p className="muted">{UNAVAILABLE}</p>;
  } else {
    const user = query.data;
    content = (
      <article className={`card ${styles.card}`}>
        {user.avatarUrl ? (
          <img
            className={styles.avatar}
            src={user.avatarUrl}
            alt={`${user.displayName}'s avatar`}
          />
        ) : (
          <div className={styles.avatar} aria-hidden="true">
            {user.displayName.charAt(0).toUpperCase()}
          </div>
        )}
        <div className={styles.identity}>
          <h2 className={styles.displayName}>{user.displayName}</h2>
          <p className={styles.username}>@{user.username}</p>
        </div>
      </article>
    );
  }

  return (
    <main className={`container ${styles.page}`}>
      <h1 className={styles.title}>Profile</h1>
      <section aria-label="Profile">{content}</section>
    </main>
  );
}
