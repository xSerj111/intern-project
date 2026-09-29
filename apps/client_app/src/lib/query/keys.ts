/** Query-key factory; invalidating a root key also matches its longer variants. */
export const postKeys = {
  feed: ['feed'] as const,
  post: (id: string) => ['post', id] as const,
  search: ['search'] as const,
  /** Session-only repost flag (workaround: the API has no `repostedByMe`). */
  reposted: (id: string) => ['reposted', id] as const,
  comments: (postId: string) => ['comments', postId] as const,
};
