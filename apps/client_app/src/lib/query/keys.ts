/** Query-key factory; invalidating a root key also matches its longer variants. */
export const postKeys = {
  feed: ['feed'] as const,
  post: (id: string) => ['post', id] as const,
  search: ['search'] as const,
  comments: (postId: string) => ['comments', postId] as const,
};
