import { Test, TestingModule } from '@nestjs/testing';
import { CommentsController } from './comments.controller';
import { CommentsService } from './comments.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../../common/auth/optional-jwt-auth.guard';
import { Comment } from './domain/entities/comment.entity';
import { fakeComment } from './__tests__/fakers/comment.faker';

describe('CommentsController', () => {
  let controller: CommentsController;
  const commentsService = {
    getCommentsByPost: jest.fn(),
    getLikeStats: jest.fn(),
    getAuthors: jest.fn(),
  };
  const comment = fakeComment();
  const query = { page: 1, limit: 20 };
  const page = (items: Comment[], hasMore = false) => ({
    items,
    page: 1,
    limit: 20,
    hasMore,
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    commentsService.getCommentsByPost.mockResolvedValue(page([comment]));
    commentsService.getLikeStats.mockResolvedValue(
      new Map([[comment.id, { likeCount: 2, likedByMe: true }]]),
    );

    commentsService.getAuthors.mockReturnValue(
      new Map([
        [
          comment.authorId,
          {
            userId: comment.authorId,
            username: 'john_doe',
            displayName: 'John Doe',
            avatarUrl: 'https://cdn/a.png',
          },
        ],
      ]),
    );

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CommentsController],
      providers: [{ provide: CommentsService, useValue: commentsService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(OptionalJwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<CommentsController>(CommentsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getCommentsByPost', () => {
    it('passes the query to the service and returns the page envelope', async () => {
      commentsService.getCommentsByPost.mockResolvedValue(
        page([comment], true),
      );

      const response = await controller.getCommentsByPost(
        undefined,
        comment.postId,
        { page: 2, limit: 5 },
      );

      expect(commentsService.getCommentsByPost).toHaveBeenCalledWith(
        comment.postId,
        { page: 2, limit: 5 },
      );
      expect(response).toMatchObject({ page: 1, limit: 20, hasMore: true });
      expect(response.items).toHaveLength(1);
    });

    it('embeds the author, loading every author in one batch', async () => {
      const other = fakeComment({ id: 'c-2' });
      commentsService.getCommentsByPost.mockResolvedValue(
        page([comment, other]),
      );

      const response = await controller.getCommentsByPost(
        'viewer-1',
        comment.postId,
        query,
      );

      expect(commentsService.getAuthors).toHaveBeenCalledTimes(1);
      expect(commentsService.getAuthors).toHaveBeenCalledWith([comment, other]);
      expect(response.items[0].author).toEqual({
        userId: comment.authorId,
        username: 'john_doe',
        displayName: 'John Doe',
        avatarUrl: 'https://cdn/a.png',
      });
    });

    it('sets author to null when the profile no longer exists', async () => {
      commentsService.getAuthors.mockReturnValue(new Map());

      const response = await controller.getCommentsByPost(
        undefined,
        comment.postId,
        query,
      );

      expect(response.items[0].author).toBeNull();
    });

    it('adds likeCount and likedByMe for the signed-in viewer', async () => {
      const response = await controller.getCommentsByPost(
        'viewer-1',
        comment.postId,
        query,
      );

      expect(commentsService.getLikeStats).toHaveBeenCalledWith(
        [comment.id],
        'viewer-1',
      );
      expect(response.items[0]).toMatchObject({
        likeCount: 2,
        likedByMe: true,
      });
    });

    it('works for an anonymous viewer (no user id)', async () => {
      commentsService.getLikeStats.mockResolvedValue(
        new Map([[comment.id, { likeCount: 2, likedByMe: false }]]),
      );

      const response = await controller.getCommentsByPost(
        undefined,
        comment.postId,
        query,
      );

      expect(commentsService.getLikeStats).toHaveBeenCalledWith(
        [comment.id],
        undefined,
      );
      expect(response.items[0]).toMatchObject({
        likeCount: 2,
        likedByMe: false,
      });
    });
  });
});
