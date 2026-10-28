'use client';

import { useQuery } from '@tanstack/react-query';

import { EditProfileForm } from '../../../../components/profile/edit-profile-form';
import { LoadError } from '../../../../components/profile/load-error';
import { Skeleton, SkeletonGroup } from '../../../../components/ui/skeleton';
import { getMyProfile, profileKeys } from '../../../../lib/api/profile';
import { useAuth } from '../../../../lib/auth/auth-context';
import { SettingsHeader } from '../_components/settings-header';
import { SignInPrompt } from '../_components/sign-in-prompt';

import styles from './page.module.css';

export default function ProfileSettingsPage() {
  const { accessToken, user, isHydrated, isSignedIn } = useAuth();

  const query = useQuery({
    queryKey: profileKeys.me(user?.id),
    queryFn: ({ signal }) => getMyProfile(accessToken, signal),
    enabled: isHydrated && Boolean(accessToken),
  });

  let content;
  if (isHydrated && !isSignedIn) {
    content = <SignInPrompt what="edit your profile" />;
  } else if (!isHydrated || query.isPending) {
    content = (
      <SkeletonGroup label="Loading your profile" className={styles.skeleton}>
        <Skeleton width={96} height={96} radius="full" />
        <Skeleton height={44} radius="md" />
        <Skeleton height={96} radius="md" />
      </SkeletonGroup>
    );
  } else if (query.isError) {
    content = (
      <LoadError
        message="We couldn’t load your profile."
        onRetry={() => void query.refetch()}
      />
    );
  } else {
    content = <EditProfileForm profile={query.data} />;
  }

  return (
    <div className={styles.page}>
      <SettingsHeader
        title="Edit profile"
        description="Your photo, name and bio are visible to everyone."
      />
      {content}
    </div>
  );
}
