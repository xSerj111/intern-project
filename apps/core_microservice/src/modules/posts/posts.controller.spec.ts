import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PostsController } from './posts.controller';
import { PostsService } from './posts.service';

describe('PostsController', () => {
  let controller: PostsController;

  const postsService = {
    getFeed: jest.fn(),
    searchPosts: jest.fn(),
    getPostDetail: jest.fn(),
    createPost: jest.fn(),
    updatePost: jest.fn(),
    publishPost: jest.fn(),
    archivePost: jest.fn(),
    softDeletePost: jest.fn(),
    likePost: jest.fn(),
    unlikePost: jest.fn(),
    repost: jest.fn(),
    unrepost: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PostsController],
      providers: [
        { provide: PostsService, useValue: postsService },
        { provide: ConfigService, useValue: { get: jest.fn() } },
      ],
    }).compile();

    controller = module.get<PostsController>(PostsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('interactions', () => {
    it('delegates like/unlike to the service', async () => {
      await controller.likePost('user-1', 'post-1');
      await controller.unlikePost('user-1', 'post-1');

      expect(postsService.likePost).toHaveBeenCalledWith('user-1', 'post-1');
      expect(postsService.unlikePost).toHaveBeenCalledWith('user-1', 'post-1');
    });

    it('delegates repost/unrepost to the service', async () => {
      await controller.repostPost('user-1', 'post-1');
      await controller.unrepostPost('user-1', 'post-1');

      expect(postsService.repost).toHaveBeenCalledWith('user-1', 'post-1');
      expect(postsService.unrepost).toHaveBeenCalledWith('user-1', 'post-1');
    });

    it('guards every mutating handler', () => {
      const guarded = [
        controller.createPost,
        controller.updatePost,
        controller.publishPost,
        controller.archivePost,
        controller.deletePost,
        controller.likePost,
        controller.unlikePost,
        controller.repostPost,
        controller.unrepostPost,
      ];

      for (const handler of guarded) {
        const guards = Reflect.getMetadata('__guards__', handler) ?? [];
        expect(guards.length).toBeGreaterThan(0);
      }
    });
  });
});
