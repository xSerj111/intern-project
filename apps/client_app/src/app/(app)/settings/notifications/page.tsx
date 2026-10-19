'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';

import type { INotificationPreferences } from '@repo/contracts';

import {
  ErrorState,
  LoadingState,
} from '../../../../components/common/async-state';
import {
  getPreferences,
  notificationKeys,
  updatePreferences,
} from '../../../../lib/api/notifications';
import { useAuth } from '../../../../lib/auth/auth-context';

import styles from './page.module.css';

const OPTIONS: ReadonlyArray<{
  key: keyof INotificationPreferences;
  label: string;
  description: string;
}> = [
  {
    key: 'emailMessages',
    label: 'Messages',
    description: 'Email me when I receive a new message.',
  },
  {
    key: 'emailComments',
    label: 'Comments',
    description: 'Email me when someone comments on my posts.',
  },
  {
    key: 'emailLikes',
    label: 'Likes',
    description: 'Email me when someone likes my posts or comments.',
  },
  {
    key: 'emailFollows',
    label: 'Follows',
    description: 'Email me when someone follows me.',
  },
];

export default function NotificationSettingsPage() {
  const { accessToken, isHydrated, isSignedIn } = useAuth();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: notificationKeys.preferences(),
    queryFn: ({ signal }) => getPreferences({ token: accessToken, signal }),
    enabled: isHydrated && Boolean(accessToken),
  });

  const mutation = useMutation({
    mutationKey: notificationKeys.preferences(),
    mutationFn: (next: INotificationPreferences) =>
      updatePreferences(next, { token: accessToken }),
    onMutate: async (next) => {
      await queryClient.cancelQueries({
        queryKey: notificationKeys.preferences(),
      });
      const previous = queryClient.getQueryData<INotificationPreferences>(
        notificationKeys.preferences(),
      );
      queryClient.setQueryData(notificationKeys.preferences(), next);
      return { previous };
    },
    onError: (_error, _next, context) => {
      if (context?.previous) {
        queryClient.setQueryData(
          notificationKeys.preferences(),
          context.previous,
        );
      }
    },
    onSettled: () => {
      // Reconcile with the server only once the last in-flight PUT is done, so
      // an earlier response cannot overwrite a newer optimistic value.
      if (
        queryClient.isMutating({
          mutationKey: notificationKeys.preferences(),
        }) <= 1
      ) {
        void queryClient.invalidateQueries({
          queryKey: notificationKeys.preferences(),
        });
      }
    },
  });

  function toggle(key: keyof INotificationPreferences, value: boolean) {
    // Read the cache (not the render closure) so quick successive toggles
    // build on each other; PUT requires all four booleans.
    const current = queryClient.getQueryData<INotificationPreferences>(
      notificationKeys.preferences(),
    );
    if (!current) {
      return;
    }
    mutation.mutate({ ...current, [key]: value });
  }

  let content;
  if (!isHydrated) {
    content = <LoadingState label="Loading your session…" />;
  } else if (!isSignedIn) {
    content = (
      <div className={styles.prompt}>
        <p className="muted">Sign in to manage your notification settings.</p>
        <Link href="/login" className="button">
          Sign in
        </Link>
      </div>
    );
  } else if (query.isPending) {
    content = <LoadingState label="Loading your preferences…" />;
  } else if (query.isError) {
    content = (
      <ErrorState
        message="We couldn't load your notification preferences. Retrying automatically…"
        onRetry={() => {
          void query.refetch();
        }}
      />
    );
  } else {
    const prefs = query.data;
    content = (
      <section className={`card ${styles.card}`} aria-label="Email preferences">
        <p className="muted">
          Choose which events send you an email. Changes apply to notifications
          created after you save.
        </p>
        <ul className={styles.list}>
          {OPTIONS.map(({ key, label, description }) => (
            <li key={key} className={styles.item}>
              <label className={styles.row}>
                <span className={styles.text}>
                  <span className={styles.label}>{label}</span>
                  <span className="muted">{description}</span>
                </span>
                <input
                  type="checkbox"
                  className={styles.checkbox}
                  checked={prefs[key]}
                  onChange={(event) => toggle(key, event.target.checked)}
                />
              </label>
            </li>
          ))}
        </ul>
        <div className={styles.status} aria-live="polite">
          {mutation.isPending && <span className="muted">Saving…</span>}
          {mutation.isSuccess && !mutation.isPending && (
            <span className={styles.saved}>Saved</span>
          )}
          {mutation.isError && (
            <span className={styles.error} role="alert">
              We couldn&apos;t save your changes. Please try again.
            </span>
          )}
        </div>
      </section>
    );
  }

  return (
    <div className={`container ${styles.page}`}>
      <h1 className={styles.title}>Notification settings</h1>
      {content}
    </div>
  );
}
