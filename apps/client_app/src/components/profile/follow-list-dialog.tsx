'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useMemo } from 'react';

import type { IChatUser } from '@repo/contracts';

import { followKeys, getFollowers, getFollowing } from '../../lib/api/follows';
import { getUsersByIds } from '../../lib/api/profile';
import { useAuth } from '../../lib/auth/auth-context';
import { FollowButton } from '../follows/follow-button';
import { Avatar } from '../ui/avatar';
import { Button } from '../ui/button';
import { Dialog } from '../ui/dialog';
import { RowSkeleton, SkeletonGroup } from '../ui/skeleton';

import { LoadError } from './load-error';
import styles from './follow-list-dialog.module.css';

export type FollowListKind = 'followers' | 'following';

/** Rows per page; the server caps `limit` at 50 and the lookup takes up to 100 ids. */
const PAGE_SIZE = 50;

interface Page {
  rows: { person: IChatUser; isFollowedByMe: boolean }[];
  page: number;
  hasMore: boolean;
}

interface FollowListDialogProps {
  open: boolean;
  onClose: () => void;
  /** Auth user id whose followers / following are listed. */
  userId: string;
  kind: FollowListKind;
}

/** Modal list of a user's followers or followees, with Follow buttons. */
export function FollowListDialog({
  open,
  onClose,
  userId,
  kind,
}: FollowListDialogProps) {
  const { accessToken, user, isHydrated } = useAuth();
  const auth = { token: accessToken };

  const list = useInfiniteQuery({
    queryKey: [
      ...(kind === 'followers'
        ? followKeys.followers(userId)
        : followKeys.following(userId)),
      'users',
      user?.id ?? null,
    ],
    initialPageParam: 1,
    queryFn: async ({ pageParam, signal }): Promise<Page> => {
      const opts = { ...auth, signal, page: pageParam, limit: PAGE_SIZE };
      const page =
        kind === 'followers'
          ? await getFollowers(userId, opts)
          : await getFollowing(userId, opts);
      const ids = page.items.map((follow) =>
        kind === 'followers' ? follow.followerId : follow.followingId,
      );
      const users = await getUsersByIds(ids, accessToken, signal);
      const byId = new Map(users.map((entry) => [entry.userId, entry]));
      // Keep the server's order (newest follow first).
      const rows = page.items.flatMap((follow, index) => {
        const person = byId.get(ids[index]);
        return person
          ? [{ person, isFollowedByMe: follow.isFollowedByMe }]
          : [];
      });
      return { rows, page: page.page, hasMore: page.hasMore };
    },
    getNextPageParam: (last) => (last.hasMore ? last.page + 1 : undefined),
    enabled: open && isHydrated,
  });

  const title = kind === 'followers' ? 'Followers' : 'Following';
  // Offset paging can repeat a row after a follow/unfollow between pages.
  const rows = useMemo(() => {
    const seen = new Set<string>();
    return (list.data?.pages ?? [])
      .flatMap((page) => page.rows)
      .filter((row) => {
        if (seen.has(row.person.userId)) return false;
        seen.add(row.person.userId);
        return true;
      });
  }, [list.data]);

  let body;
  if (list.isPending) {
    body = (
      <SkeletonGroup label={`Loading ${title.toLowerCase()}`}>
        <RowSkeleton count={5} />
      </SkeletonGroup>
    );
  } else if (list.isError) {
    body = (
      <LoadError
        message={`We couldn’t load ${title.toLowerCase()}.`}
        onRetry={() => void list.refetch()}
      />
    );
  } else if (rows.length === 0) {
    body = (
      <p className={styles.empty}>
        {kind === 'followers'
          ? 'No followers yet.'
          : 'Not following anyone yet.'}
      </p>
    );
  } else {
    body = (
      <ul className={styles.list}>
        {rows.map(({ person, isFollowedByMe }) => (
          <li key={person.userId} className={styles.row}>
            <Link
              href={`/profile/${person.userId}`}
              className={styles.person}
              onClick={onClose}
            >
              <Avatar
                src={person.avatarUrl}
                name={person.displayName}
                decorative
              />
              <span className={styles.names}>
                <span className={styles.displayName}>{person.displayName}</span>
                <span className={styles.username}>@{person.username}</span>
              </span>
            </Link>
            <FollowButton
              userId={person.userId}
              isFollowing={isFollowedByMe}
              size="sm"
            />
          </li>
        ))}
      </ul>
    );
  }

  return (
    <Dialog open={open} onClose={onClose} title={title} size="sm" flush>
      {body}
      {list.hasNextPage && (
        <div className={styles.more}>
          <Button
            size="sm"
            variant="secondary"
            loading={list.isFetchingNextPage}
            onClick={() => {
              void list.fetchNextPage();
            }}
          >
            Load more
          </Button>
        </div>
      )}
    </Dialog>
  );
}
