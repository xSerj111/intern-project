import { Test, TestingModule } from '@nestjs/testing';
import { PostsController } from './posts.controller';
import { PostsService } from './posts.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../../common/auth/optional-jwt-auth.guard';
import { fakePost } from './__tests__/fakers/post.faker';
import { Post, PostStatus } from './domain/entities/post.entity';

describe('PostsController', () => {
  let controller: PostsController;
  const postsService = {
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

  describe('response mapping', () => {
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
      postsService.getPost.mockResolvedValue(mapped);
      postsService.getCommentCounts.mockResolvedValue(
        new Map([[mapped.id, 7]]),
      );
      postsService.getLikeStats.mockResolvedValue(
        new Map([[mapped.id, { likeCount: 4, likedByMe: true }]]),
      );

      const response = await controller.getPost('viewer-1', mapped.id);

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
      postsService.getPost.mockResolvedValue(post);
      postsService.getCommentCounts.mockResolvedValue(new Map());

      const response = await controller.getPost(undefined, post.id);

      expect(response.author).toBeNull();
      expect(response.commentCount).toBe(0);
    });

    it('skips assets whose file was deleted (asset joined as null)', async () => {
      postsService.getPost.mockResolvedValue(
        fakePost({
          assets: [
            { assetId: 'gone', displayOrder: 0, asset: null },
          ] as unknown as Post['assets'],
        }),
      );

      const response = await controller.getPost(undefined, post.id);

      expect(response.assets).toEqual([]);
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
      expect(response).toMatchObject({ total: 9, page: 2, limit: 5 });
      expect(response.items[0]).toMatchObject({ commentCount: 7 });
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
