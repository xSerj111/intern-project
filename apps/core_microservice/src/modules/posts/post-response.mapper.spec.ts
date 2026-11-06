import { PostResponseMapper } from './post-response.mapper';
import { PostsService } from './posts.service';
import { fakePost } from './__tests__/fakers/post.faker';
import { Post } from './domain/entities/post.entity';

describe('PostResponseMapper', () => {
  const postsService = {
    getLikeStats: jest.fn(),
    getCommentCounts: jest.fn(),
  };
  const post = fakePost();
  let mapper: PostResponseMapper;

  beforeEach(() => {
    jest.clearAllMocks();
    postsService.getLikeStats.mockResolvedValue(
      new Map([[post.id, { likeCount: 4, likedByMe: true }]]),
    );
    postsService.getCommentCounts.mockResolvedValue(new Map([[post.id, 7]]));
    mapper = new PostResponseMapper(postsService as unknown as PostsService);
  });

  it('adds likeCount and likedByMe for the signed-in viewer', async () => {
    const response = await mapper.toResponse(post, 'viewer-1');

    expect(postsService.getLikeStats).toHaveBeenCalledWith(
      [post.id],
      'viewer-1',
    );
    expect(response).toMatchObject({ likeCount: 4, likedByMe: true });
  });

  it('works for an anonymous viewer (no user id)', async () => {
    postsService.getLikeStats.mockResolvedValue(
      new Map([[post.id, { likeCount: 4, likedByMe: false }]]),
    );

    const response = await mapper.toResponse(post);

    expect(postsService.getLikeStats).toHaveBeenCalledWith(
      [post.id],
      undefined,
    );
    expect(response).toMatchObject({ likeCount: 4, likedByMe: false });
  });

  it('enriches a whole list with one query each', async () => {
    const other = fakePost({ id: '00000000-0000-0000-0000-000000000011' });

    const responses = await mapper.toResponses([post, other], 'viewer-1');

    expect(postsService.getLikeStats).toHaveBeenCalledTimes(1);
    expect(postsService.getCommentCounts).toHaveBeenCalledTimes(1);
    expect(postsService.getCommentCounts).toHaveBeenCalledWith([
      post.id,
      other.id,
    ]);
    expect(responses[0]).toMatchObject({ likeCount: 4, commentCount: 7 });
    expect(responses[1]).toMatchObject({
      likeCount: 0,
      likedByMe: false,
      commentCount: 0,
    });
  });

  it('adds commentCount, author and asset url/mimeType', async () => {
    const mapped = fakePost({
      author: {
        authUserId: 'author-1',
        username: 'john_doe',
        displayName: 'John Doe',
        avatarUrl: null,
      } as Post['author'],
      assets: [
        {
          assetId: 'a-2',
          displayOrder: 1,
          asset: { url: null, mimeType: 'application/pdf' },
        },
        {
          assetId: 'a-1',
          displayOrder: 0,
          asset: { url: 'https://cdn/1.png', mimeType: 'image/png' },
        },
      ] as unknown as Post['assets'],
    });
    postsService.getCommentCounts.mockResolvedValue(new Map([[mapped.id, 7]]));
    postsService.getLikeStats.mockResolvedValue(
      new Map([[mapped.id, { likeCount: 4, likedByMe: true }]]),
    );

    const response = await mapper.toResponse(mapped, 'viewer-1');

    expect(postsService.getCommentCounts).toHaveBeenCalledWith([mapped.id]);
    expect(response.commentCount).toBe(7);
    expect(response.author).toEqual({
      userId: 'author-1',
      username: 'john_doe',
      displayName: 'John Doe',
      avatarUrl: null,
    });
    expect(response.assets).toEqual([
      {
        assetId: 'a-1',
        displayOrder: 0,
        url: 'https://cdn/1.png',
        mimeType: 'image/png',
      },
      {
        assetId: 'a-2',
        displayOrder: 1,
        url: null,
        mimeType: 'application/pdf',
      },
    ]);
  });

  it('returns author null and defaults commentCount to 0 when missing', async () => {
    postsService.getCommentCounts.mockResolvedValue(new Map());

    const response = await mapper.toResponse(post);

    expect(response.author).toBeNull();
    expect(response.commentCount).toBe(0);
  });

  it('skips assets whose file was deleted (asset joined as null)', async () => {
    const withGone = fakePost({
      assets: [
        { assetId: 'gone', displayOrder: 0, asset: null },
      ] as unknown as Post['assets'],
    });

    const response = await mapper.toResponse(withGone);

    expect(response.assets).toEqual([]);
  });
});
