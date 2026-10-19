import { Test, TestingModule } from '@nestjs/testing';
import { LoggerKey } from '@repo/shared';
import { PostsService } from './posts.service';
import { POST_REPOSITORY } from './domain/interfaces/post-repository.port';
import { FollowRepositoryKey } from '../follows/domain/interfaces/follow-repository.port';

describe('PostsService', () => {
  let service: PostsService;
  const postRepository = { getLikeStats: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PostsService,
        { provide: LoggerKey, useValue: {} },
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
});
