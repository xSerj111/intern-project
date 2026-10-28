import { Test, TestingModule } from '@nestjs/testing';
import { EntityByIdNotFoundError, LoggerKey } from '@repo/shared';
import { AssetsService } from '../assets/assets.service';
import { AssetNotAttachableError } from '../assets/domain/errors/asset.errors';
import { ProfileSummaryCache } from '../../common/cache/profile-summary-cache';
import { PostsService } from './posts.service';
import { POST_REPOSITORY } from './domain/interfaces/post-repository.port';
import {
  InvalidPostStateError,
  PostStatus,
} from './domain/entities/post.entity';
import { PostStatusNotVisibleError } from './domain/entities/post.entity';
import { fakePost } from './__tests__/fakers/post.faker';
import { FeedCursor } from './domain/feed-cursor';

describe('PostsService', () => {
  let service: PostsService;
  const postRepository = {
    getLikeStats: jest.fn(),
    getCommentCounts: jest.fn(),
    findByAuthor: jest.fn(),
    save: jest.fn(),
    findOneByIdOrThrow: jest.fn(),
    findFeedPage: jest.fn(),
    softDelete: jest.fn(),
  };
  const cache = { invalidateCounts: jest.fn() };
  const assets = { findByIds: jest.fn() };
  const fakeAsset = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    isOwnedBy: (u: string) => u === AUTHOR,
    assertAttachableTo: jest.fn(),
    ...over,
  });
  const AUTHOR = '11111111-1111-1111-1111-111111111111';

  beforeEach(async () => {
    jest.clearAllMocks();
    assets.findByIds.mockResolvedValue([]);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PostsService,
        { provide: LoggerKey, useValue: { debug: jest.fn() } },
        { provide: POST_REPOSITORY, useValue: postRepository },
        { provide: ProfileSummaryCache, useValue: cache },
        { provide: AssetsService, useValue: assets },
      ],
    }).compile();

    service = module.get<PostsService>(PostsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getFeed', () => {
    const cursor = FeedCursor.fromRow({
      t: '2026-01-02T03:04:05.123456Z',
      id: '22222222-2222-2222-2222-222222222222',
    });

    it('asks for the first page with a null cursor and passes nextCursor through', async () => {
      const post = fakePost();
      postRepository.findFeedPage.mockResolvedValue({
        posts: [post],
        nextCursor: 'next-1',
      });

      const result = await service.getFeed(AUTHOR, undefined, 20);

      expect(postRepository.findFeedPage).toHaveBeenCalledWith(
        AUTHOR,
        null,
        20,
      );
      expect(result).toEqual({ items: [post], nextCursor: 'next-1' });
    });

    it('decodes the cursor before querying', async () => {
      postRepository.findFeedPage.mockResolvedValue({
        posts: [],
        nextCursor: null,
      });

      const result = await service.getFeed(AUTHOR, cursor.encode(), 5);

      expect(postRepository.findFeedPage).toHaveBeenCalledWith(
        AUTHOR,
        expect.objectContaining({ t: cursor.t, id: cursor.id }),
        5,
      );
      expect(result).toEqual({ items: [], nextCursor: null });
    });
  });

  describe('getLikeStats', () => {
    it('delegates to the repository with the viewer id', async () => {
      const stats = new Map([['p-1', { likeCount: 1, likedByMe: true }]]);
      postRepository.getLikeStats.mockResolvedValue(stats);

      await expect(service.getLikeStats(['p-1'], 'viewer-1')).resolves.toBe(
        stats,
      );
      expect(postRepository.getLikeStats).toHaveBeenCalledWith(
        ['p-1'],
        'viewer-1',
      );
    });
  });

  describe('getCommentCounts', () => {
    it('delegates to the repository (one batch call)', async () => {
      const counts = new Map([['p-1', 3]]);
      postRepository.getCommentCounts.mockResolvedValue(counts);

      await expect(service.getCommentCounts(['p-1'])).resolves.toBe(counts);
      expect(postRepository.getCommentCounts).toHaveBeenCalledWith(['p-1']);
    });
  });

  describe('getPostsByAuthor', () => {
    it('lists published posts for anonymous viewers', async () => {
      const post = fakePost();
      postRepository.findByAuthor.mockResolvedValue([[post], 1]);

      const result = await service.getPostsByAuthor(
        AUTHOR,
        PostStatus.Published,
        2,
        10,
        undefined,
      );

      expect(postRepository.findByAuthor).toHaveBeenCalledWith(
        AUTHOR,
        PostStatus.Published,
        2,
        10,
      );
      expect(result).toEqual({ items: [post], total: 1 });
    });

    it('lists drafts for the author', async () => {
      postRepository.findByAuthor.mockResolvedValue([[], 0]);

      await service.getPostsByAuthor(AUTHOR, PostStatus.Draft, 1, 20, AUTHOR);

      expect(postRepository.findByAuthor).toHaveBeenCalledWith(
        AUTHOR,
        PostStatus.Draft,
        1,
        20,
      );
    });

    it.each([PostStatus.Draft, PostStatus.Archived])(
      'forbids %s posts for another user without querying',
      async (status) => {
        await expect(
          service.getPostsByAuthor(AUTHOR, status, 1, 20, 'someone-else'),
        ).rejects.toBeInstanceOf(PostStatusNotVisibleError);
        await expect(
          service.getPostsByAuthor(AUTHOR, status, 1, 20, undefined),
        ).rejects.toBeInstanceOf(PostStatusNotVisibleError);
        expect(postRepository.findByAuthor).not.toHaveBeenCalled();
      },
    );
  });

  describe('createPost', () => {
    it('reloads the saved post so author and asset files are joined', async () => {
      const saved = fakePost({ id: 'new-1' });
      const reloaded = fakePost({ id: 'new-1', content: 'reloaded' });
      postRepository.save.mockResolvedValue(saved);
      postRepository.findOneByIdOrThrow.mockResolvedValue(reloaded);
      const asset = fakeAsset('a-1');
      assets.findByIds.mockResolvedValue([asset]);

      const result = await service.createPost(AUTHOR, {
        content: 'hello',
        assetIds: ['a-1'],
      });

      expect(postRepository.findOneByIdOrThrow).toHaveBeenCalledWith('new-1');
      expect(result).toBe(reloaded);
      expect(asset.assertAttachableTo).toHaveBeenCalledWith('post', AUTHOR);
    });

    it.each([
      ['missing or unconfirmed', []],
      ['owned by someone else', [fakeAsset('a-1', { isOwnedBy: () => false })]],
    ])(
      'answers 404 and saves nothing when an asset is %s',
      async (_n, rows) => {
        assets.findByIds.mockResolvedValue(rows);

        await expect(
          service.createPost(AUTHOR, { content: 'hi', assetIds: ['a-1'] }),
        ).rejects.toBeInstanceOf(EntityByIdNotFoundError);
        expect(postRepository.save).not.toHaveBeenCalled();
      },
    );

    it('propagates the asset rule when the asset does not fit a post', async () => {
      const asset = fakeAsset('a-1', {
        assertAttachableTo: jest.fn(() => {
          throw new AssetNotAttachableError('post');
        }),
      });
      assets.findByIds.mockResolvedValue([asset]);

      await expect(
        service.createPost(AUTHOR, { content: 'hi', assetIds: ['a-1'] }),
      ).rejects.toBeInstanceOf(AssetNotAttachableError);
      expect(postRepository.save).not.toHaveBeenCalled();
    });

    it('skips the asset lookup when no assets are attached', async () => {
      postRepository.save.mockResolvedValue(fakePost({ id: 'n' }));
      postRepository.findOneByIdOrThrow.mockResolvedValue(fakePost());

      await service.createPost(AUTHOR, { content: 'hi' });

      expect(assets.findByIds).not.toHaveBeenCalled();
    });

    it('runs no like-stats or comment-count query for the new post', async () => {
      postRepository.save.mockResolvedValue(fakePost({ id: 'new-2' }));
      postRepository.findOneByIdOrThrow.mockResolvedValue(
        fakePost({ id: 'new-2' }),
      );

      await service.createPost(AUTHOR, { content: 'hello' });

      expect(postRepository.getLikeStats).not.toHaveBeenCalled();
      expect(postRepository.getCommentCounts).not.toHaveBeenCalled();
    });
  });

  describe('updatePost', () => {
    it('recomputes the hashtags on the saved entity', async () => {
      const post = fakePost({
        authorId: AUTHOR,
        content: '#old',
        hashtags: ['old'],
      });
      postRepository.findOneByIdOrThrow.mockResolvedValue(post);
      postRepository.save.mockImplementation((p: unknown) =>
        Promise.resolve(p),
      );

      const result = await service.updatePost(AUTHOR, post.id, {
        content: 'fresh #New',
      });

      expect(result.content).toBe('fresh #New');
      expect(result.hashtags).toEqual(['new']);
      expect(postRepository.save).toHaveBeenCalledWith(post);
    });
  });

  describe('counts cache invalidation', () => {
    it('invalidates the author counts after publishing a draft', async () => {
      const draft = fakePost({ id: 'p-1', authorId: AUTHOR });
      postRepository.findOneByIdOrThrow.mockResolvedValue(draft);
      postRepository.save.mockImplementation((p: unknown) =>
        Promise.resolve(p),
      );

      await service.publishPost(AUTHOR, 'p-1');

      expect(cache.invalidateCounts).toHaveBeenCalledWith(AUTHOR);
      expect(
        cache.invalidateCounts.mock.invocationCallOrder[0],
      ).toBeGreaterThan(postRepository.save.mock.invocationCallOrder[0]);
    });

    it('does not invalidate when publish is rejected', async () => {
      postRepository.findOneByIdOrThrow.mockResolvedValue(
        fakePost({ authorId: AUTHOR, status: PostStatus.Published }),
      );

      await expect(service.publishPost(AUTHOR, 'p-1')).rejects.toBeInstanceOf(
        InvalidPostStateError,
      );
      expect(cache.invalidateCounts).not.toHaveBeenCalled();
    });

    it('invalidates the author counts after a delete', async () => {
      postRepository.findOneByIdOrThrow.mockResolvedValue(
        fakePost({ authorId: AUTHOR }),
      );
      postRepository.softDelete.mockResolvedValue(undefined);

      await service.softDeletePost(AUTHOR, 'p-1');

      expect(postRepository.softDelete).toHaveBeenCalledTimes(1);
      expect(cache.invalidateCounts).toHaveBeenCalledWith(AUTHOR);
    });

    it('invalidates the author counts after archiving', async () => {
      postRepository.findOneByIdOrThrow.mockResolvedValue(
        fakePost({ authorId: AUTHOR, status: PostStatus.Published }),
      );
      postRepository.save.mockImplementation((p: unknown) =>
        Promise.resolve(p),
      );

      await service.archivePost(AUTHOR, 'p-1');

      expect(cache.invalidateCounts).toHaveBeenCalledWith(AUTHOR);
    });
  });
});
