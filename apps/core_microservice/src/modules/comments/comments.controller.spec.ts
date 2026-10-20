import { Test, TestingModule } from '@nestjs/testing';
import { CommentsController } from './comments.controller';
import { CommentsService } from './comments.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../../common/auth/optional-jwt-auth.guard';
import { fakeComment } from './__tests__/fakers/comment.faker';

describe('CommentsController', () => {
  let controller: CommentsController;
  const commentsService = {
    getCommentsByPost: jest.fn(),
    getLikeStats: jest.fn(),
    getAuthors: jest.fn(),
  };
  const comment = fakeComment();

  beforeEach(async () => {
    jest.clearAllMocks();
    commentsService.getCommentsByPost.mockResolvedValue([comment]);
    commentsService.getLikeStats.mockResolvedValue(
      new Map([[comment.id, { likeCount: 2, likedByMe: true }]]),
    );

    commentsService.getAuthors.mockResolvedValue(
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
    it('embeds the author, loading every author in one batch', async () => {
      const other = fakeComment({ id: 'c-2' });
      commentsService.getCommentsByPost.mockResolvedValue([comment, other]);

      const response = await controller.getCommentsByPost(
        'viewer-1',
        comment.postId,
      );

      expect(commentsService.getAuthors).toHaveBeenCalledTimes(1);
      expect(commentsService.getAuthors).toHaveBeenCalledWith([comment, other]);
      expect(response[0].author).toEqual({
        userId: comment.authorId,
        username: 'john_doe',
        displayName: 'John Doe',
        avatarUrl: 'https://cdn/a.png',
      });
    });

    it('sets author to null when the profile no longer exists', async () => {
      commentsService.getAuthors.mockResolvedValue(new Map());

      const response = await controller.getCommentsByPost(
        undefined,
        comment.postId,
      );

      expect(response[0].author).toBeNull();
    });

    it('adds likeCount and likedByMe for the signed-in viewer', async () => {
      const response = await controller.getCommentsByPost(
        'viewer-1',
        comment.postId,
      );

      expect(commentsService.getLikeStats).toHaveBeenCalledWith(
        [comment.id],
        'viewer-1',
      );
      expect(response[0]).toMatchObject({ likeCount: 2, likedByMe: true });
    });

    it('works for an anonymous viewer (no user id)', async () => {
      commentsService.getLikeStats.mockResolvedValue(
        new Map([[comment.id, { likeCount: 2, likedByMe: false }]]),
      );

      const response = await controller.getCommentsByPost(
        undefined,
        comment.postId,
      );

      expect(commentsService.getLikeStats).toHaveBeenCalledWith(
        [comment.id],
        undefined,
      );
      expect(response[0]).toMatchObject({ likeCount: 2, likedByMe: false });
    });
  });
});
