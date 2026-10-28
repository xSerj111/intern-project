'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { INotificationPreferences } from '@repo/contracts';

import { LoadError } from '../../../../components/profile/load-error';
import { Skeleton, SkeletonGroup } from '../../../../components/ui/skeleton';
import { Switch } from '../../../../components/ui/switch';
import {
  getPreferences,
  notificationKeys,
  updatePreferences,
} from '../../../../lib/api/notifications';
import { useAuth } from '../../../../lib/auth/auth-context';
import { SettingsHeader } from '../_components/settings-header';
import { SignInPrompt } from '../_components/sign-in-prompt';

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
  if (!isSignedIn && isHydrated) {
    content = <SignInPrompt what="manage your notification settings" />;
  } else if (!isHydrated || query.isPending) {
    content = (
      <SkeletonGroup
        label="Loading your preferences"
        className={styles.skeleton}
      >
        {OPTIONS.map(({ key }) => (
          <Skeleton key={key} height={44} radius="md" />
        ))}
      </SkeletonGroup>
    );
  } else if (query.isError) {
    content = (
      <LoadError
        message="We couldn’t load your notification preferences."
        onRetry={() => {
          void query.refetch();
        }}
      />
    );
  } else {
    const prefs = query.data;
    content = (
      <section className={styles.card} aria-label="Email preferences">
        <ul className={styles.list}>
          {OPTIONS.map(({ key, label, description }) => (
            <li key={key} className={styles.item}>
              <Switch
                label={label}
                description={description}
                checked={prefs[key]}
                onChange={(value) => toggle(key, value)}
              />
            </li>
          ))}
        </ul>
        <div className={styles.status} aria-live="polite">
          {mutation.isPending && (
            <span className={styles.muted}>Saving…</span>
          )}
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
    <div className={styles.page}>
      <SettingsHeader
        title="Notifications"
        description="Choose which events send you an email. Changes apply to notifications created after you save."
      />
      {content}
    </div>
  );
}
