import { Test, TestingModule } from '@nestjs/testing';
import { PostsController } from './posts.controller';
import { PostsService } from './posts.service';
import { PostResponseMapper } from './post-response.mapper';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../../common/auth/optional-jwt-auth.guard';
import { fakePost } from './__tests__/fakers/post.faker';
import { PostStatus } from './domain/entities/post.entity';

describe('PostsController', () => {
  let controller: PostsController;
  const postsService = {
    createPost: jest.fn(),
    getPost: jest.fn(),
    getFeed: jest.fn(),
    searchPosts: jest.fn(),
    getLikeStats: jest.fn(),
    getCommentCounts: jest.fn(),
    getPostsByAuthor: jest.fn(),
  };
  const post = fakePost();

  beforeEach(async () => {
    jest.clearAllMocks();
    postsService.getLikeStats.mockResolvedValue(
      new Map([[post.id, { likeCount: 4, likedByMe: true }]]),
    );

    postsService.getCommentCounts.mockResolvedValue(new Map([[post.id, 7]]));

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PostsController],
      providers: [
        { provide: PostsService, useValue: postsService },
        PostResponseMapper,
      ],
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

  describe('createPost', () => {
    it('responds with zero counts and no enrichment queries', async () => {
      postsService.createPost.mockResolvedValue(post);

      const response = await controller.createPost('viewer-1', {
        content: 'hello',
      });

      expect(postsService.createPost).toHaveBeenCalledWith('viewer-1', {
        content: 'hello',
      });
      expect(postsService.getLikeStats).not.toHaveBeenCalled();
      expect(postsService.getCommentCounts).not.toHaveBeenCalled();
      expect(response).toMatchObject({
        id: post.id,
        likeCount: 0,
        commentCount: 0,
        likedByMe: false,
      });
    });
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

  describe('getPostsByAuthor', () => {
    const AUTHOR = '11111111-1111-1111-1111-111111111111';

    it('passes the viewer, status and paging to the service and wraps the page', async () => {
      postsService.getPostsByAuthor.mockResolvedValue({
        items: [post],
        total: 9,
      });

      const response = await controller.getPostsByAuthor('viewer-1', AUTHOR, {
        page: 2,
        limit: 5,
        status: 'published',
      });

      expect(postsService.getPostsByAuthor).toHaveBeenCalledWith(
        AUTHOR,
        PostStatus.Published,
        2,
        5,
        'viewer-1',
      );
      expect(postsService.getLikeStats).toHaveBeenCalledWith(
        [post.id],
        'viewer-1',
      );
      expect(response).toMatchObject({
        total: 9,
        page: 2,
        limit: 5,
        hasMore: false,
      });
      expect(response.items[0]).toMatchObject({ commentCount: 7 });
    });

    it('sets hasMore when more rows exist past this page', async () => {
      postsService.getPostsByAuthor.mockResolvedValue({
        items: [post],
        total: 11,
      });

      const response = await controller.getPostsByAuthor(undefined, AUTHOR, {
        page: 2,
        limit: 5,
        status: 'published',
      });

      expect(response.hasMore).toBe(true);
    });

    it('works for an anonymous viewer', async () => {
      postsService.getPostsByAuthor.mockResolvedValue({ items: [], total: 0 });

      await controller.getPostsByAuthor(undefined, AUTHOR, {
        page: 1,
        limit: 20,
        status: 'published',
      });

      expect(postsService.getPostsByAuthor).toHaveBeenCalledWith(
        AUTHOR,
        PostStatus.Published,
        1,
        20,
        undefined,
      );
    });

    it('is declared before :id so the route is not shadowed', () => {
      const names = Object.getOwnPropertyNames(PostsController.prototype);
      expect(names.indexOf('getPostsByAuthor')).toBeLessThan(
        names.indexOf('getPost'),
      );
    });
  });

  describe('getFeed', () => {
    it('passes cursor and limit and returns items with nextCursor', async () => {
      postsService.getFeed.mockResolvedValue({
        items: [post],
        nextCursor: 'next-1',
      });

      const response = await controller.getFeed('viewer-1', {
        cursor: 'cur-1',
        limit: 10,
      });

      expect(postsService.getFeed).toHaveBeenCalledWith(
        'viewer-1',
        'cur-1',
        10,
      );
      expect(response.items[0]).toMatchObject({
        likeCount: 4,
        likedByMe: true,
      });
      expect(response.nextCursor).toBe('next-1');
      expect(Object.keys(response).sort()).toEqual(['items', 'nextCursor']);
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
