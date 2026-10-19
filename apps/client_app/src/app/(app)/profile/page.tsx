'use client';

import { UserRound } from 'lucide-react';
import Link from 'next/link';

import { ProfileView } from '../../../components/profile/profile-view';
import { buttonClassName } from '../../../components/ui/button';
import { EmptyState } from '../../../components/ui/empty-state';
import { ProfileHeaderSkeleton, SkeletonGroup } from '../../../components/ui/skeleton';
import { useAuth } from '../../../lib/auth/auth-context';

/** The signed-in user's own profile (same view as `/profile/{id}`). */
export default function ProfilePage() {
  const { user, isHydrated } = useAuth();

  if (!isHydrated) {
    return (
      <div className="container">
        <SkeletonGroup label="Loading profile">
          <ProfileHeaderSkeleton />
        </SkeletonGroup>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="container">
        <EmptyState
          icon={UserRound}
          title="Sign in to see your profile"
          action={
            <Link href="/login" className={buttonClassName()}>
              Log in
            </Link>
          }
        />
      </div>
    );
  }

  return <ProfileView userId={user.id} />;
}
