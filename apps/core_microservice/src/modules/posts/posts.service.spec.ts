import { Test, TestingModule } from '@nestjs/testing';
import { LoggerKey } from '@repo/shared';
import { PostsService } from './posts.service';
import { POST_REPOSITORY } from './domain/interfaces/post-repository.port';
import { FollowRepositoryKey } from '../follows/domain/interfaces/follow-repository.port';
import { PostStatus } from './domain/entities/post.entity';
import { PostStatusNotVisibleError } from './domain/entities/post.entity';
import { fakePost } from './__tests__/fakers/post.faker';

describe('PostsService', () => {
  let service: PostsService;
  const postRepository = {
    getLikeStats: jest.fn(),
    getCommentCounts: jest.fn(),
    findByAuthor: jest.fn(),
    save: jest.fn(),
    findOneByIdOrThrow: jest.fn(),
  };
  const AUTHOR = '11111111-1111-1111-1111-111111111111';

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PostsService,
        { provide: LoggerKey, useValue: { debug: jest.fn() } },
        { provide: POST_REPOSITORY, useValue: postRepository },
        { provide: FollowRepositoryKey, useValue: {} },
      ],
    }).compile();

    service = module.get<PostsService>(PostsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
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

      const result = await service.createPost(AUTHOR, {
        content: 'hello',
        assetIds: ['a-1'],
      });

      expect(postRepository.findOneByIdOrThrow).toHaveBeenCalledWith('new-1');
      expect(result).toBe(reloaded);
    });
  });
});
