import { Test, TestingModule } from '@nestjs/testing';
import { LoggerKey, UnauthorizedError } from '@repo/shared';

import { PostsService } from './posts.service';
import { PostRepository } from './infrastructure/repository/post.repository';
import { PostLikeRepository } from './infrastructure/repository/post-like.repository';
import { RepostRepositoryKey } from './domain/interfaces/repost-repository.port';
import { CommentRepository } from '../comments/infrastructure/repository/comment.repository';
import { FollowRepositoryKey } from '../follows/domain/interfaces/follow-repository.port';
import { fakePost } from './__tests__/fakers/post.faker';
import {
  InvalidPostStateError,
  type Post,
  PostStatus,
} from './domain/entities/post.entity';
import { PostAsset } from './domain/entities/post-asset.entity';
import { Asset } from '../assets/domain/entities/asset.entity';
import { RepostNotAllowedError } from './domain/errors/post.errors';

/** Build a `PostAsset` with a nested `Asset` of the given MIME type. */
function fakeAsset(mimeType: string): PostAsset {
  const attachment = new PostAsset();
  attachment.assetId = `asset-${mimeType}`;
  attachment.displayOrder = 0;
  attachment.asset = Object.assign(new Asset(), { mimeType });
  return attachment;
}

/** Minimal re-post shape the feed merge consumes. */
function fakeRepost(id: string, originalPost: Post) {
  return {
    id,
    originalPostId: originalPost.id,
    authorId: 'reposter-1',
    originalPost,
    author: { authUserId: 'reposter-1', username: 'reposter' },
    createdAt: new Date('2026-02-01T00:00:00.000Z'),
  };
}

describe('PostsService', () => {
  let service: PostsService;

  const logger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  const postRepository = {
    getFeed: jest.fn(),
    searchPublishedPosts: jest.fn(),
    findOneByIdOrThrow: jest.fn(),
    save: jest.fn(),
    softDelete: jest.fn(),
    replaceAssets: jest.fn(),
  };

  const postLikeRepository = {
    countByPostIds: jest.fn(),
    findLikedPostIds: jest.fn(),
    like: jest.fn(),
    unlike: jest.fn(),
  };

  const repostRepository = {
    countByOriginalPostIds: jest.fn(),
    repost: jest.fn(),
    unrepost: jest.fn(),
    findByOriginalAndAuthor: jest.fn(),
    findFeed: jest.fn(),
  };

  const commentRepository = {
    countByPostIds: jest.fn(),
  };

  const followRepository = {
    findFollowing: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    postLikeRepository.countByPostIds.mockResolvedValue(new Map());
    postLikeRepository.findLikedPostIds.mockResolvedValue(new Set());
    repostRepository.countByOriginalPostIds.mockResolvedValue(new Map());
    repostRepository.findFeed.mockResolvedValue([[], 0]);
    commentRepository.countByPostIds.mockResolvedValue(new Map());
    followRepository.findFollowing.mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PostsService,
        { provide: LoggerKey, useValue: logger },
        { provide: PostRepository, useValue: postRepository },
        { provide: PostLikeRepository, useValue: postLikeRepository },
        { provide: RepostRepositoryKey, useValue: repostRepository },
        { provide: CommentRepository, useValue: commentRepository },
        { provide: FollowRepositoryKey, useValue: followRepository },
      ],
    }).compile();

    service = module.get<PostsService>(PostsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getFeed', () => {
    const viewer = 'viewer-1';

    it('scopes the following feed to the viewer plus followed accounts', async () => {
      followRepository.findFollowing.mockResolvedValue([
        { followingId: 'followed-1' },
        { followingId: 'followed-2' },
      ]);
      postRepository.getFeed.mockResolvedValue([[], 0]);

      await service.getFeed(viewer, 'following', 'newest', undefined, 1, 20);

      expect(postRepository.getFeed).toHaveBeenCalledWith({
        authorIds: [viewer, 'followed-1', 'followed-2'],
        sort: 'newest',
        mediaType: undefined,
        page: 1,
        limit: 20,
      });
    });

    it('does not filter by author for the discover feed', async () => {
      postRepository.getFeed.mockResolvedValue([[], 0]);

      await service.getFeed(viewer, 'discover', 'newest', undefined, 1, 20);

      expect(postRepository.getFeed).toHaveBeenCalledWith({
        authorIds: undefined,
        sort: 'newest',
        mediaType: undefined,
        page: 1,
        limit: 20,
      });
      expect(followRepository.findFollowing).not.toHaveBeenCalled();
    });

    it('attaches batched engagement counts and viewer like state', async () => {
      const post = fakePost({
        id: 'post-1',
        status: PostStatus.Published,
      });
      postRepository.getFeed.mockResolvedValue([[post], 1]);
      postLikeRepository.countByPostIds.mockResolvedValue(
        new Map([['post-1', 7]]),
      );
      commentRepository.countByPostIds.mockResolvedValue(
        new Map([['post-1', 3]]),
      );
      repostRepository.countByOriginalPostIds.mockResolvedValue(
        new Map([['post-1', 2]]),
      );
      postLikeRepository.findLikedPostIds.mockResolvedValue(
        new Set(['post-1']),
      );

      const result = await service.getFeed(
        viewer,
        'following',
        'newest',
        undefined,
        1,
        20,
      );

      expect(result.total).toBe(1);
      const entry = result.items[0];
      expect(entry.kind).toBe('post');
      expect(
        entry.kind === 'post' ? entry.engagement : undefined,
      ).toEqual({
        likeCount: 7,
        commentCount: 3,
        repostCount: 2,
        likedByMe: true,
      });
    });

    it('passes the sort and media-type filter through to the repository', async () => {
      postRepository.getFeed.mockResolvedValue([[], 0]);

      await service.getFeed(viewer, 'discover', 'most_liked', 'photos', 2, 10);

      expect(postRepository.getFeed).toHaveBeenCalledWith(
        expect.objectContaining({
          sort: 'most_liked',
          mediaType: 'photos',
          page: 2,
          limit: 10,
        }),
      );
    });

    it('orders merged feed entries oldest-first when sort=oldest', async () => {
      const older = fakePost({
        id: 'older',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      });
      const newer = fakePost({
        id: 'newer',
        createdAt: new Date('2026-02-01T00:00:00.000Z'),
      });
      // Repository returns them newest-first; the service re-orders the merge.
      postRepository.getFeed.mockResolvedValue([[newer, older], 2]);

      const result = await service.getFeed(
        viewer,
        'discover',
        'oldest',
        undefined,
        1,
        20,
      );

      expect(result.items.map((item) => item.kind === 'post' && item.post.id)).toEqual(
        ['older', 'newer'],
      );
    });

    it('orders merged feed entries by like count when sort=most_liked', async () => {
      const popular = fakePost({ id: 'popular' });
      const quiet = fakePost({ id: 'quiet' });
      postRepository.getFeed.mockResolvedValue([[quiet, popular], 2]);
      postLikeRepository.countByPostIds.mockResolvedValue(
        new Map([
          ['popular', 9],
          ['quiet', 1],
        ]),
      );

      const result = await service.getFeed(
        viewer,
        'discover',
        'most_liked',
        undefined,
        1,
        20,
      );

      expect(result.items.map((item) => item.kind === 'post' && item.post.id)).toEqual(
        ['popular', 'quiet'],
      );
    });

    it('excludes re-posts whose original post does not match the media filter', async () => {
      const withPhoto = fakePost({
        id: 'photo-post',
        assets: [fakeAsset('image/png')],
      });
      const textOnly = fakePost({ id: 'text-post', assets: [] });
      postRepository.getFeed.mockResolvedValue([[], 0]);
      repostRepository.findFeed.mockResolvedValue([
        [
          fakeRepost('repost-photo', withPhoto),
          fakeRepost('repost-text', textOnly),
        ],
        2,
      ]);

      const result = await service.getFeed(
        viewer,
        'discover',
        'newest',
        'photos',
        1,
        20,
      );

      expect(result.items).toHaveLength(1);
      const entry = result.items[0];
      expect(entry.kind === 'repost' && entry.repost.id).toBe('repost-photo');
    });
  });

  describe('getPostDetail', () => {
    it('returns the post with engagement and likedByMe=false when anonymous', async () => {
      const post = fakePost({ id: 'post-9' });
      postRepository.findOneByIdOrThrow.mockResolvedValue(post);

      const result = await service.getPostDetail('post-9');

      expect(result.post).toBe(post);
      expect(result.engagement.likedByMe).toBe(false);
      expect(postLikeRepository.findLikedPostIds).not.toHaveBeenCalled();
    });
  });

  describe('createPost', () => {
    it('saves a draft by default', async () => {
      postRepository.save.mockImplementation(async (post) => post);

      const post = await service.createPost('author-1', { content: 'hello' });

      expect(post.status).toBe(PostStatus.Draft);
      expect(postRepository.save).toHaveBeenCalledTimes(1);
    });

    it('publishes immediately when publish=true and content is present', async () => {
      postRepository.save.mockImplementation(async (post) => post);

      const post = await service.createPost('author-1', {
        content: 'hello',
        publish: true,
      });

      expect(post.status).toBe(PostStatus.Published);
    });

    it('rejects an empty publish with InvalidPostStateError and does not save', async () => {
      await expect(
        service.createPost('author-1', { content: '', publish: true }),
      ).rejects.toThrow(InvalidPostStateError);

      expect(postRepository.save).not.toHaveBeenCalled();
    });

    it('maps assetIds to ordered PostAsset rows', async () => {
      postRepository.save.mockImplementation(async (post) => post);

      const post = await service.createPost('author-1', {
        content: 'with media',
        assetIds: ['asset-a', 'asset-b'],
      });

      expect(post.assets.map((asset) => asset.assetId)).toEqual([
        'asset-a',
        'asset-b',
      ]);
      expect(post.assets.map((asset) => asset.displayOrder)).toEqual([0, 1]);
    });
  });

  describe('likes', () => {
    it('likes a post idempotently after verifying it exists', async () => {
      postRepository.findOneByIdOrThrow.mockResolvedValue(fakePost());
      postLikeRepository.like.mockResolvedValue(undefined);

      await service.likePost('user-1', 'post-1');

      expect(postLikeRepository.like).toHaveBeenCalledWith('post-1', 'user-1');
    });

    it('propagates a not-found error and does not like', async () => {
      postRepository.findOneByIdOrThrow.mockRejectedValue(new Error('not found'));

      await expect(service.likePost('user-1', 'missing')).rejects.toThrow(
        'not found',
      );
      expect(postLikeRepository.like).not.toHaveBeenCalled();
    });

    it('unlikes a post', async () => {
      postRepository.findOneByIdOrThrow.mockResolvedValue(fakePost());
      postLikeRepository.unlike.mockResolvedValue(undefined);

      await service.unlikePost('user-1', 'post-1');

      expect(postLikeRepository.unlike).toHaveBeenCalledWith('post-1', 'user-1');
    });
  });

  describe('reposts', () => {
    it('reposts a published post', async () => {
      postRepository.findOneByIdOrThrow.mockResolvedValue(
        fakePost({ status: PostStatus.Published }),
      );
      repostRepository.repost.mockResolvedValue(undefined);

      await service.repost('user-1', 'post-1');

      expect(repostRepository.repost).toHaveBeenCalledWith('post-1', 'user-1');
    });

    it('rejects reposting a non-published post', async () => {
      postRepository.findOneByIdOrThrow.mockResolvedValue(
        fakePost({ status: PostStatus.Draft }),
      );

      await expect(service.repost('user-1', 'post-1')).rejects.toThrow(
        RepostNotAllowedError,
      );
      expect(repostRepository.repost).not.toHaveBeenCalled();
    });

    it('unreposts idempotently', async () => {
      postRepository.findOneByIdOrThrow.mockResolvedValue(fakePost());
      repostRepository.unrepost.mockResolvedValue(undefined);

      await service.unrepost('user-1', 'post-1');

      expect(repostRepository.unrepost).toHaveBeenCalledWith('post-1', 'user-1');
    });
  });

  describe('updatePost', () => {
    it('updates text for the author', async () => {
      const post = fakePost({ authorId: 'author-1', content: 'old' });
      postRepository.findOneByIdOrThrow.mockResolvedValue(post);
      postRepository.save.mockImplementation(async (entity) => entity);

      const updated = await service.updatePost('author-1', 'post-1', {
        content: 'new',
      });

      expect(updated.content).toBe('new');
    });

    it('denies a non-author with UnauthorizedError', async () => {
      postRepository.findOneByIdOrThrow.mockResolvedValue(
        fakePost({ authorId: 'author-1' }),
      );

      await expect(
        service.updatePost('intruder', 'post-1', { content: 'hack' }),
      ).rejects.toThrow(UnauthorizedError);

      expect(postRepository.save).not.toHaveBeenCalled();
    });

    it('replaces media wholesale when assetIds is provided', async () => {
      const post = fakePost({ authorId: 'author-1' });
      postRepository.findOneByIdOrThrow.mockResolvedValue(post);
      postRepository.save.mockImplementation(async (entity) => entity);
      postRepository.replaceAssets.mockResolvedValue(undefined);

      await service.updatePost('author-1', 'post-1', {
        assetIds: ['a', 'b', 'c'],
      });

      expect(postRepository.replaceAssets).toHaveBeenCalledWith('post-1', [
        'a',
        'b',
        'c',
      ]);
    });

    it('leaves media untouched when assetIds is omitted', async () => {
      postRepository.findOneByIdOrThrow.mockResolvedValue(
        fakePost({ authorId: 'author-1' }),
      );
      postRepository.save.mockImplementation(async (entity) => entity);

      await service.updatePost('author-1', 'post-1', { content: 'only text' });

      expect(postRepository.replaceAssets).not.toHaveBeenCalled();
    });
  });

  describe('feed reposts', () => {    it('includes repost entries with the original post and attribution', async () => {
      const original = fakePost({ id: 'orig-1', status: PostStatus.Published });
      postRepository.getFeed.mockResolvedValue([[], 0]);
      repostRepository.findFeed.mockResolvedValue([
        [
          {
            id: 'repost-1',
            originalPostId: 'orig-1',
            authorId: 'reposter-1',
            originalPost: original,
            author: { authUserId: 'reposter-1', username: 'reposter' },
            createdAt: new Date('2026-02-01T00:00:00.000Z'),
          },
        ],
        1,
      ]);

      const result = await service.getFeed(
        'viewer-1',
        'discover',
        'newest',
        undefined,
        1,
        20,
      );

      expect(result.total).toBe(1);
      expect(result.items[0].kind).toBe('repost');
    });
  });
});
