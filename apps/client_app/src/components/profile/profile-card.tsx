'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';

import type { IProfileResponse } from '@repo/contracts';

import { getMyProfile } from '../../lib/api/profile';
import { useAuth } from '../../lib/auth/auth-context';
import { ErrorState, LoadingState } from '../common/async-state';

import styles from './profile-card.module.css';

function Avatar({ profile }: { profile: IProfileResponse }) {
  if (profile.avatarUrl) {
    return (
      <img
        className={styles.avatar}
        src={profile.avatarUrl}
        alt={`${profile.displayName}'s avatar`}
      />
    );
  }

  return (
    <div
      className={`${styles.avatar} ${styles.avatarFallback}`}
      aria-hidden="true"
    >
      {profile.displayName.charAt(0).toUpperCase()}
    </div>
  );
}

/** Profile section: renders the signed-in user's own profile. */
export function ProfileCard() {
  const { accessToken, isHydrated, isSignedIn } = useAuth();

  const query = useQuery({
    queryKey: ['profile', 'me', accessToken],
    queryFn: ({ signal }) => getMyProfile(accessToken, signal),
    enabled: isHydrated && Boolean(accessToken),
  });

  if (!isHydrated) {
    return <LoadingState label="Loading your session…" />;
  }

  if (!isSignedIn) {
    return (
      <div className={styles.prompt}>
        <p className="muted">Sign in to view your profile.</p>
        <Link href="/login" className="button">
          Sign in
        </Link>
      </div>
    );
  }

  if (query.isPending) {
    return <LoadingState label="Loading your profile…" />;
  }

  if (query.isError) {
    return (
      <ErrorState
        message="We couldn't load your profile. Retrying automatically…"
        onRetry={() => {
          void query.refetch();
        }}
      />
    );
  }

  const profile = query.data;

  return (
    <article className={`card ${styles.card}`}>
      <div className={styles.header}>
        <Avatar profile={profile} />
        <div className={styles.identity}>
          <h2 className={styles.displayName}>{profile.displayName}</h2>
          <p className={styles.username}>@{profile.username}</p>
        </div>
      </div>
      {profile.bio && <p className={styles.bio}>{profile.bio}</p>}
    </article>
  );
}
