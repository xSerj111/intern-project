'use client';

import {
  useInfiniteQuery,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query';
import { Bell, CloudOff } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';

import type { INotificationsPage } from '@repo/contracts';

import { NotificationItem } from '../../../components/notifications/notification-item';
import { groupNotifications } from '../../../components/notifications/notification-groups';
import { Button, buttonClassName } from '../../../components/ui/button';
import { EmptyState } from '../../../components/ui/empty-state';
import { RowSkeleton, SkeletonGroup } from '../../../components/ui/skeleton';
import { Spinner } from '../../../components/ui/spinner';
import {
  listNotifications,
  markSeen,
  notificationKeys,
} from '../../../lib/api/notifications';
import { useAuth } from '../../../lib/auth/auth-context';

import styles from './page.module.css';

const PAGE_SIZE = 20;
/** Start loading the next page this far before the sentinel scrolls into view. */
const PREFETCH_MARGIN = '400px';

export default function NotificationsPage() {
  const { accessToken, isHydrated, isSignedIn } = useAuth();
  const queryClient = useQueryClient();

  // Cache shape under notificationKeys.list(): InfiniteData<INotificationsPage>,
  // newest first; the page cursor is the opaque `nextCursor` (`before`).
  const query = useInfiniteQuery<
    INotificationsPage,
    Error,
    InfiniteData<INotificationsPage, string | undefined>,
    ReturnType<typeof notificationKeys.list>,
    string | undefined
  >({
    queryKey: notificationKeys.list(),
    initialPageParam: undefined,
    queryFn: ({ pageParam, signal }) =>
      listNotifications(
        { before: pageParam, limit: PAGE_SIZE },
        { token: accessToken, signal },
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: isHydrated && Boolean(accessToken),
  });

  // Ids that were unseen when the page opened stay highlighted after markSeen.
  const [openedUnseen, setOpenedUnseen] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const markedRef = useRef(false);
  const firstPage = query.data?.pages[0];

  useEffect(() => {
    if (!firstPage || markedRef.current || !accessToken) {
      return;
    }
    markedRef.current = true;
    setOpenedUnseen(
      new Set(firstPage.items.filter((n) => !n.seen).map((n) => n.id)),
    );
    markSeen({}, { token: accessToken })
      .then(({ unseenCount }) => {
        queryClient.setQueryData(notificationKeys.unseenCount(), {
          unseenCount,
        });
      })
      .catch(() => {
        markedRef.current = false;
      });
  }, [firstPage, accessToken, queryClient]);

  // Infinite scroll: fetch the next page when the sentinel nears the viewport.
  const sentinelRef = useRef<HTMLDivElement>(null);
  const {
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
    fetchNextPage,
  } = query;

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasNextPage || isFetchingNextPage || isFetchNextPageError) {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void fetchNextPage();
        }
      },
      { rootMargin: PREFETCH_MARGIN },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage]);

  const items = useMemo(
    () => (query.data?.pages ?? []).flatMap((page) => page.items),
    [query.data],
  );
  const groups = useMemo(() => groupNotifications(items), [items]);

  let content;
  if (!isHydrated || (isSignedIn && query.isPending)) {
    content = (
      <SkeletonGroup label="Loading your notifications…">
        <RowSkeleton count={6} />
      </SkeletonGroup>
    );
  } else if (!isSignedIn) {
    content = (
      <EmptyState
        icon={Bell}
        title="Sign in to see your notifications"
        description="Likes, comments and new followers show up here."
        action={
          <Link href="/login" className={buttonClassName()}>
            Sign in
          </Link>
        }
      />
    );
  } else if (query.isError) {
    content = (
      <EmptyState
        icon={CloudOff}
        title="Couldn't load notifications"
        description="Check your connection and try again."
        action={
          <Button variant="secondary" onClick={() => void query.refetch()}>
            Try again
          </Button>
        }
      />
    );
  } else if (items.length === 0) {
    content = (
      <EmptyState
        icon={Bell}
        title="No notifications yet"
        description="When someone likes or comments on your posts, or starts following you, you'll see it here."
      />
    );
  } else {
    content = (
      <>
        {groups.map((group) => (
          <section
            key={group.bucket}
            className={styles.group}
            aria-labelledby={`notifications-${group.bucket}`}
          >
            <h2
              id={`notifications-${group.bucket}`}
              className={styles.groupTitle}
            >
              {group.label}
            </h2>
            <ul className={styles.list}>
              {group.items.map((notification) => (
                <li key={notification.id}>
                  <NotificationItem
                    notification={notification}
                    highlighted={
                      !notification.seen || openedUnseen.has(notification.id)
                    }
                  />
                </li>
              ))}
            </ul>
          </section>
        ))}

        {hasNextPage && (
          <div ref={sentinelRef} className={styles.more}>
            {isFetchNextPageError ? (
              <Button variant="secondary" onClick={() => void fetchNextPage()}>
                Couldn&apos;t load more. Try again
              </Button>
            ) : (
              <Spinner size={20} label="Loading more notifications" />
            )}
          </div>
        )}
      </>
    );
  }

  return (
    <div className={`container ${styles.page}`}>
      <h1 className={styles.title}>Notifications</h1>
      {content}
    </div>
  );
}
