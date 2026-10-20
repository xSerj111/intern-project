'use client';

import { useQuery } from '@tanstack/react-query';
import { FileText, ImageOff } from 'lucide-react';
import { useState } from 'react';

import { getPost, postKeys } from '../../lib/api/posts';
import { useAuth } from '../../lib/auth/auth-context';
import { Skeleton } from '../ui/skeleton';

import styles from './notification-thumb.module.css';

/**
 * Square preview of the post a notification refers to: its first image, or a
 * neutral tile for text-only, deleted or unreachable posts.
 *
 * Reads the post through the shared post cache (one request per post). The
 * query neither retries nor polls: a deleted post just keeps the neutral tile.
 */
export function NotificationThumb({ postId }: { postId: string }) {
  const { accessToken, isHydrated } = useAuth();
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  const query = useQuery({
    queryKey: [...postKeys.detail(postId), 'thumb'],
    queryFn: ({ signal }) => getPost(postId, { token: accessToken, signal }),
    enabled: isHydrated && Boolean(accessToken),
    staleTime: 5 * 60_000,
    retry: false,
    refetchInterval: false,
  });

  if (query.isPending && query.fetchStatus !== 'idle') {
    return <Skeleton width={44} height={44} radius="sm" />;
  }

  const image = [...(query.data?.assets ?? [])]
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .find((asset) => asset.url && asset.mimeType.startsWith('image/'));

  if (image?.url && image.url !== failedUrl) {
    return (
      // Plain <img>: asset hosts (SeaweedFS, presigned URLs) vary per deployment.
      <img
        src={image.url}
        alt=""
        className={styles.thumb}
        loading="lazy"
        decoding="async"
        onError={() => setFailedUrl(image.url)}
      />
    );
  }

  const Icon = query.isError || image ? ImageOff : FileText;
  return (
    <span className={styles.tile} aria-hidden="true">
      <Icon size={20} />
    </span>
  );
}
