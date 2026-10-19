'use client';

import {
  useInfiniteQuery,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import type { INotificationsPage } from '@repo/contracts';

import { ErrorState, LoadingState } from '../../../components/common/async-state';
import { NotificationItem } from '../../../components/notifications/notification-item';
import {
  listNotifications,
  markSeen,
  notificationKeys,
} from '../../../lib/api/notifications';
import { useAuth } from '../../../lib/auth/auth-context';

import styles from './page.module.css';

const PAGE_SIZE = 20;

export default function NotificationsPage() {
  const { accessToken, isHydrated, isSignedIn } = useAuth();
  const queryClient = useQueryClient();

  // Cache shape under notificationKeys.list(): InfiniteData<INotificationsPage>,
  // newest first; the page cursor is the last item's `occurredAt` (`before`).
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
    getNextPageParam: (last) =>
      last.hasMore ? last.items.at(-1)?.occurredAt : undefined,
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

  let content;
  if (!isHydrated || (isSignedIn && query.isPending)) {
    content = <LoadingState label="Loading your notifications…" />;
  } else if (!isSignedIn) {
    content = <p className="muted">Sign in to see your notifications.</p>;
  } else if (query.isError) {
    content = (
      <ErrorState
        message="We couldn't load your notifications."
        onRetry={() => void query.refetch()}
      />
    );
  } else {
    const items = (query.data?.pages ?? []).flatMap((page) => page.items);
    content =
      items.length === 0 ? (
        <p className="muted">No notifications yet.</p>
      ) : (
        <>
          <ul className={styles.list}>
            {items.map((notification) => (
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
          {query.hasNextPage && (
            <button
              type="button"
              className="button button--ghost"
              disabled={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage()}
            >
              {query.isFetchingNextPage ? 'Loading…' : 'Load more'}
            </button>
          )}
        </>
      );
  }

  return (
    <div className={`container ${styles.page}`}>
      <h1 className={styles.title}>Notifications</h1>
      <section aria-label="Notifications">{content}</section>
    </div>
  );
}
