'use client';

import { useQuery } from '@tanstack/react-query';
import { UserRoundX } from 'lucide-react';
import Link from 'next/link';

import { ApiError } from '../../lib/api/client';
import { getProfileSummary, profileKeys } from '../../lib/api/profile';
import { useAuth } from '../../lib/auth/auth-context';
import { buttonClassName } from '../ui/button';
import { EmptyState } from '../ui/empty-state';
import { ProfileHeaderSkeleton, SkeletonGroup } from '../ui/skeleton';

import { LoadError } from './load-error';
import { ProfileHeader } from './profile-header';
import { ProfilePosts } from './profile-posts';
import styles from './profile-view.module.css';

/** Full profile page body for an auth user id (own profile or someone else's). */
export function ProfileView({ userId }: { userId: string }) {
  const { accessToken, user, isHydrated } = useAuth();
  const isOwn = user?.id === userId;

  const query = useQuery({
    queryKey: profileKeys.summary(userId),
    queryFn: ({ signal }) => getProfileSummary(userId, accessToken, signal),
    enabled: isHydrated,
    retry: (count, error) =>
      !(error instanceof ApiError && [400, 404].includes(error.status)) &&
      count < 2,
  });

  let content;
  if (!isHydrated || query.isPending) {
    content = (
      <SkeletonGroup label="Loading profile">
        <ProfileHeaderSkeleton />
      </SkeletonGroup>
    );
  } else if (
    query.isError &&
    query.error instanceof ApiError &&
    [400, 404].includes(query.error.status)
  ) {
    content = (
      <EmptyState
        icon={UserRoundX}
        title="This profile isn’t available"
        description="The link may be broken, or the profile may have been removed."
        action={
          <Link href="/" className={buttonClassName({ variant: 'secondary' })}>
            Back home
          </Link>
        }
      />
    );
  } else if (query.isError) {
    content = (
      <LoadError
        message="We couldn’t load this profile."
        onRetry={() => void query.refetch()}
      />
    );
  } else {
    content = (
      <>
        <ProfileHeader profile={query.data} isOwn={isOwn} />
        <ProfilePosts userId={userId} isOwn={isOwn} />
      </>
    );
  }

  return <div className={styles.page}>{content}</div>;
}
