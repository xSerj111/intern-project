import {
  PostStatus,
  type IPostMediaResponse,
  type IPostResponse,
} from '@repo/contracts';

/** Build a media attachment with sensible defaults. */
export function fakeMedia(
  overrides: Partial<IPostMediaResponse> = {},
): IPostMediaResponse {
  return {
    assetId: 'asset-1',
    url: 'https://example.test/asset-1.png',
    mimeType: 'image/png',
    mediaType: 'image',
    displayOrder: 0,
    ...overrides,
  };
}

/** Build a post response with sensible defaults. */
export function fakePost(overrides: Partial<IPostResponse> = {}): IPostResponse {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    author: {
      id: '00000000-0000-0000-0000-000000000002',
      username: 'ada',
      displayName: 'Ada Lovelace',
      avatarUrl: null,
    },
    content: 'Hello world',
    status: PostStatus.Published,
    assets: [],
    likeCount: 3,
    commentCount: 2,
    repostCount: 1,
    likedByMe: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}
