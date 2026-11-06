export const SEARCH_TABS = ['people', 'posts', 'tags'] as const;

export type SearchTab = (typeof SEARCH_TABS)[number];

// Match the backend DTO minimums: SearchProfilesQueryDto (people),
// SearchQueryDto keyword (posts), hashtag `q` after normalization (tags).
export const MIN_QUERY_LENGTH: Record<SearchTab, number> = {
  people: 2,
  posts: 3,
  tags: 1,
};

export function parseTab(
  value: string | null | undefined,
  signedIn: boolean,
): SearchTab {
  const tab = SEARCH_TABS.find((t) => t === value);
  if (tab) return tab;
  return signedIn ? 'people' : 'posts';
}

export function isQueryLongEnough(tab: SearchTab, q: string): boolean {
  const query = tab === 'tags' && q.startsWith('#') ? q.slice(1) : q;
  return query.trim().length >= MIN_QUERY_LENGTH[tab];
}
