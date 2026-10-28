'use client';

import { SearchX } from 'lucide-react';

import { FeedList } from '../../../../components/feed/feed-list';
import { EmptyState } from '../../../../components/ui/empty-state';
import { getHashtagFeed, searchKeys } from '../../../../lib/api/search';

/** Client wrapper: `fetchPage` is a function, which cannot cross the server boundary. */
export function TagFeed({ tag }: { tag: string }) {
  return (
    <FeedList
      queryKey={searchKeys.tagFeed(tag)}
      fetchPage={(cursor, token) => getHashtagFeed(tag, { cursor }, token)}
      emptyState={
        <EmptyState
          icon={SearchX}
          title={`No posts with #${tag} yet`}
          description="Posts that use this hashtag will show up here."
        />
      }
    />
  );
}
