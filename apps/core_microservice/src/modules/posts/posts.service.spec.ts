import { Test, TestingModule } from '@nestjs/testing';
import { LoggerKey } from '@repo/shared';

import { PostsService } from './posts.service';
import { PostRepository } from './infrastructure/repository/post.repository';
import { PostLikeRepository } from './infrastructure/repository/post-like.repository';
import { RepostRepositoryKey } from './domain/interfaces/repost-repository.port';
import { CommentRepository } from '../comments/infrastructure/repository/comment.repository';
import { FollowRepositoryKey } from '../follows/domain/interfaces/follow-repository.port';
import { fakePost } from './__tests__/fakers/post.faker';
import { PostStatus } from './domain/entities/post.entity';

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
      expect(result.items[0].engagement).toEqual({
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
});
