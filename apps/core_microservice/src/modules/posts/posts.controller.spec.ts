import { Test, TestingModule } from '@nestjs/testing';
import { PostsController } from './posts.controller';
import { PostsService } from './posts.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../../common/auth/optional-jwt-auth.guard';
import { fakePost } from './__tests__/fakers/post.faker';

describe('PostsController', () => {
  let controller: PostsController;
  const postsService = {
    getPost: jest.fn(),
    getFeed: jest.fn(),
    searchPosts: jest.fn(),
    getLikeStats: jest.fn(),
  };
  const post = fakePost();

  beforeEach(async () => {
    jest.clearAllMocks();
    postsService.getLikeStats.mockResolvedValue(
      new Map([[post.id, { likeCount: 4, likedByMe: true }]]),
    );

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PostsController],
      providers: [{ provide: PostsService, useValue: postsService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(OptionalJwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<PostsController>(PostsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getPost', () => {
    it('adds likeCount and likedByMe for the signed-in viewer', async () => {
      postsService.getPost.mockResolvedValue(post);

      const response = await controller.getPost('viewer-1', post.id);

      expect(postsService.getLikeStats).toHaveBeenCalledWith(
        [post.id],
        'viewer-1',
      );
      expect(response).toMatchObject({ likeCount: 4, likedByMe: true });
    });

    it('works for an anonymous viewer (no user id)', async () => {
      postsService.getPost.mockResolvedValue(post);
      postsService.getLikeStats.mockResolvedValue(
        new Map([[post.id, { likeCount: 4, likedByMe: false }]]),
      );

      const response = await controller.getPost(undefined, post.id);

      expect(postsService.getLikeStats).toHaveBeenCalledWith(
        [post.id],
        undefined,
      );
      expect(response).toMatchObject({ likeCount: 4, likedByMe: false });
    });
  });

  describe('getFeed', () => {
    it('adds like state to every item', async () => {
      postsService.getFeed.mockResolvedValue({ items: [post], total: 1 });

      const response = await controller.getFeed('viewer-1', {
        page: 1,
        limit: 10,
      });

      expect(response.items[0]).toMatchObject({
        likeCount: 4,
        likedByMe: true,
      });
      expect(response.total).toBe(1);
    });
  });

  describe('searchPosts', () => {
    it('adds like state and tolerates an anonymous viewer', async () => {
      postsService.searchPosts.mockResolvedValue({ items: [post], total: 1 });

      const response = await controller.searchPosts(undefined, {
        keyword: 'faked',
        page: 1,
        limit: 10,
      });

      expect(postsService.getLikeStats).toHaveBeenCalledWith(
        [post.id],
        undefined,
      );
      expect(response.items).toHaveLength(1);
    });
  });
});
