'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import { Camera, FileText, Grid3x3, Heart, Images, MessageCircle } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import { PostStatus, type IPostResponse } from '@repo/contracts';

import { getPostsByAuthor, postKeys } from '../../lib/api/posts';
import { useAuth } from '../../lib/auth/auth-context';
import { formatCount } from '../../lib/format/time';
import { useComposer } from '../shell/composer-context';
import { Button } from '../ui/button';
import { EmptyState } from '../ui/empty-state';
import { Skeleton, SkeletonGroup } from '../ui/skeleton';
import { Spinner } from '../ui/spinner';
import { Tabs, tabPanelProps, type TabItem } from '../ui/tabs';

import { LoadError } from './load-error';
import styles from './profile-posts.module.css';

const PAGE_SIZE = 12;
const ID_PREFIX = 'profile-posts';

type PostsTab = 'posts' | 'drafts';

/** First displayable image of a post, if any. */
function coverOf(post: IPostResponse): string | null {
  const first = [...(post.assets ?? [])]
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .find((asset) => asset.mimeType.startsWith('image/') && asset.url);
  return first?.url ?? null;
}

function PostTile({ post, draft }: { post: IPostResponse; draft: boolean }) {
  const cover = coverOf(post);
  const mediaCount = post.assets?.length ?? 0;
  const label = post.content.trim() || 'Post';

  return (
    <li className={styles.item}>
      <Link
        href={`/posts/${post.id}`}
        className={styles.tile}
        aria-label={
          draft ? `Draft: ${label.slice(0, 80)}` : label.slice(0, 80)
        }
      >
        {cover ? (
          <img
            src={cover}
            alt=""
            className={styles.image}
            loading="lazy"
            decoding="async"
          />
        ) : (
          <span className={styles.text}>
            <span className={styles.textBody}>{post.content}</span>
          </span>
        )}

        {draft && <span className={styles.draftBadge}>Draft</span>}
        {mediaCount > 1 && (
          <Images
            size={20}
            className={styles.multi}
            aria-label={`${mediaCount} photos`}
          />
        )}

        <span className={styles.overlay} aria-hidden="true">
          <span className={styles.overlayStat}>
            <Heart size={18} fill="currentColor" /> {formatCount(post.likeCount)}
          </span>
          <span className={styles.overlayStat}>
            <MessageCircle size={18} fill="currentColor" />{' '}
            {formatCount(post.commentCount)}
          </span>
        </span>
      </Link>
    </li>
  );
}

function GridSkeleton() {
  return (
    <SkeletonGroup label="Loading posts">
      <div className={styles.grid}>
        {Array.from({ length: 9 }, (_, index) => (
          <Skeleton
            key={index}
            height="auto"
            radius="sm"
            className={styles.skeletonTile}
          />
        ))}
      </div>
    </SkeletonGroup>
  );
}

function PostsGrid({
  userId,
  status,
  isOwn,
}: {
  userId: string;
  status: PostStatus;
  isOwn: boolean;
}) {
  const { accessToken, isHydrated } = useAuth();
  const { openComposer } = useComposer();
  const sentinel = useRef<HTMLDivElement>(null);

  const query = useInfiniteQuery({
    queryKey: [...postKeys.byAuthor(userId, status), 'grid'],
    queryFn: ({ pageParam, signal }) =>
      getPostsByAuthor(
        userId,
        { page: pageParam, limit: PAGE_SIZE, status },
        { token: accessToken, signal },
      ),
    initialPageParam: 1,
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((sum, page) => sum + page.items.length, 0);
      return lastPage.items.length > 0 && loaded < lastPage.total
        ? lastPage.page + 1
        : undefined;
    },
    enabled: isHydrated,
  });

  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;
  useEffect(() => {
    const node = sentinel.current;
    if (!node || !hasNextPage) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void fetchNextPage();
        }
      },
      { rootMargin: '400px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasNextPage, fetchNextPage, query.data]);

  if (!isHydrated || query.isPending) return <GridSkeleton />;

  if (query.isError) {
    return (
      <LoadError
        message="We couldn’t load these posts."
        onRetry={() => void query.refetch()}
      />
    );
  }

  const posts = query.data.pages.flatMap((page) => page.items);

  if (posts.length === 0) {
    if (status === PostStatus.Draft) {
      return (
        <EmptyState
          icon={FileText}
          title="No drafts"
          description="Posts you haven’t published yet show up here, visible only to you."
        />
      );
    }
    return (
      <EmptyState
        icon={Camera}
        title={isOwn ? 'Share your first post' : 'No posts yet'}
        description={
          isOwn
            ? 'When you share photos and thoughts, they’ll appear on your profile.'
            : 'When they share something, it will show up here.'
        }
        action={
          isOwn && <Button onClick={openComposer}>Create post</Button>
        }
      />
    );
  }

  return (
    <>
      <ul className={styles.grid}>
        {posts.map((post) => (
          <PostTile
            key={post.id}
            post={post}
            draft={status === PostStatus.Draft}
          />
        ))}
      </ul>
      {hasNextPage && (
        <div ref={sentinel} className={styles.more}>
          {isFetchingNextPage ? (
            <Spinner size={24} label="Loading more posts" />
          ) : (
            <Button variant="secondary" onClick={() => void fetchNextPage()}>
              Load more
            </Button>
          )}
        </div>
      )}
    </>
  );
}

interface ProfilePostsProps {
  /** Auth user id of the profile owner. */
  userId: string;
  isOwn: boolean;
}

/** Posts grid of a profile, plus a Drafts tab for the owner. */
export function ProfilePosts({ userId, isOwn }: ProfilePostsProps) {
  const [tab, setTab] = useState<PostsTab>('posts');
  const activeTab: PostsTab = isOwn ? tab : 'posts';

  const items: TabItem<PostsTab>[] = [
    { id: 'posts', label: 'Posts', icon: Grid3x3 },
    ...(isOwn ? [{ id: 'drafts' as const, label: 'Drafts', icon: FileText }] : []),
  ];

  return (
    <section className={styles.section} aria-label="Posts">
      <Tabs
        items={items}
        value={activeTab}
        onChange={setTab}
        label="Profile content"
        idPrefix={ID_PREFIX}
      />
      <div {...tabPanelProps(ID_PREFIX, activeTab)} className={styles.panel}>
        <PostsGrid
          key={`${userId}-${activeTab}`}
          userId={userId}
          isOwn={isOwn}
          status={
            activeTab === 'drafts' ? PostStatus.Draft : PostStatus.Published
          }
        />
      </div>
    </section>
  );
}
