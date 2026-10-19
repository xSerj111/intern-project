'use client';

import { useParams } from 'next/navigation';

import { ProfileView } from '../../../../components/profile/profile-view';

/** Public profile for an auth user id. */
export default function UserProfilePage() {
  const { userId } = useParams<{ userId: string }>();
  return <ProfileView userId={userId} />;
}
