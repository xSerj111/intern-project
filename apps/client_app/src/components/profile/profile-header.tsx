'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MessageCircle, Settings } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { IProfileSummaryResponse } from '@repo/contracts';

import { chatKeys, createDirectChat } from '../../lib/api/chats';
import { useAuth } from '../../lib/auth/auth-context';
import { formatCount } from '../../lib/format/time';
import { FollowButton } from '../follows/follow-button';
import { Avatar } from '../ui/avatar';
import { Button, buttonClassName } from '../ui/button';

import { EditProfileDialog } from './edit-profile-dialog';
import { FollowListDialog, type FollowListKind } from './follow-list-dialog';
import styles from './profile-header.module.css';

interface ProfileHeaderProps {
  profile: IProfileSummaryResponse;
  isOwn: boolean;
}

/** Avatar, identity, counts, bio and the primary actions of a profile. */
export function ProfileHeader({ profile, isOwn }: ProfileHeaderProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { accessToken } = useAuth();
  const [editing, setEditing] = useState(false);
  const [list, setList] = useState<FollowListKind | null>(null);
  // Remember the last kind so the dialog doesn't flash its title while closing.
  const [lastList, setLastList] = useState<FollowListKind>('followers');

  const openList = (kind: FollowListKind) => {
    setLastList(kind);
    setList(kind);
  };

  const message = useMutation({
    mutationFn: () =>
      createDirectChat(profile.authUserId, { token: accessToken }),
    onSuccess: async (chat) => {
      await queryClient.invalidateQueries({ queryKey: chatKeys.list() });
      router.push(`/messages/${chat.id}`);
    },
  });

  const stats = [
    { label: 'posts', value: profile.postCount },
    { label: 'followers', value: profile.followerCount, kind: 'followers' },
    { label: 'following', value: profile.followingCount, kind: 'following' },
  ] as const;

  return (
    <header className={styles.header}>
      <div className={styles.avatar}>
        <span className={styles.avatarLarge}>
          <Avatar
            src={profile.avatarUrl}
            name={profile.displayName}
            size="2xl"
            ring
          />
        </span>
        <span className={styles.avatarSmall}>
          <Avatar
            src={profile.avatarUrl}
            name={profile.displayName}
            size="xl"
            ring
          />
        </span>
      </div>

      <div className={styles.identity}>
        <h1 className={styles.displayName}>{profile.displayName}</h1>
        <p className={styles.username}>@{profile.username}</p>
      </div>

      {(isOwn || accessToken) && (
        <div className={styles.actionsWrap}>
          <div className={styles.actions}>
            {isOwn ? (
              <>
                <Button variant="secondary" onClick={() => setEditing(true)}>
                  Edit profile
                </Button>
                <Link
                  href="/settings"
                  className={buttonClassName(
                    { variant: 'secondary' },
                    styles.settingsLink,
                  )}
                  aria-label="Settings"
                >
                  <Settings size={18} aria-hidden="true" />
                </Link>
              </>
            ) : (
              <>
                <FollowButton
                  userId={profile.authUserId}
                  isFollowing={profile.isFollowedByMe}
                />
                <Button
                  variant="secondary"
                  loading={message.isPending}
                  icon={<MessageCircle size={16} aria-hidden="true" />}
                  onClick={() => message.mutate()}
                >
                  Message
                </Button>
              </>
            )}
          </div>
          {message.isError && (
            <p className={styles.error} role="alert">
              We couldn’t open the conversation. Please try again.
            </p>
          )}
        </div>
      )}

      <ul className={styles.stats}>
        {stats.map((stat) => {
          const content = (
            <>
              <span className={styles.statValue}>{formatCount(stat.value)}</span>
              <span className={styles.statLabel}>{stat.label}</span>
            </>
          );
          return (
            <li key={stat.label} className={styles.stat}>
              {'kind' in stat ? (
                <button
                  type="button"
                  className={styles.statButton}
                  aria-label={`${stat.value} ${stat.label}`}
                  onClick={() => openList(stat.kind)}
                >
                  {content}
                </button>
              ) : (
                <span
                  className={styles.statStatic}
                  aria-label={`${stat.value} ${stat.label}`}
                >
                  {content}
                </span>
              )}
            </li>
          );
        })}
      </ul>

      {profile.bio && <p className={styles.bio}>{profile.bio}</p>}

      {isOwn && (
        <EditProfileDialog
          open={editing}
          onClose={() => setEditing(false)}
          profile={profile}
        />
      )}
      <FollowListDialog
        open={list !== null}
        onClose={() => setList(null)}
        userId={profile.authUserId}
        kind={list ?? lastList}
      />
    </header>
  );
}
