import { Test, TestingModule } from '@nestjs/testing';
import { CommentsController } from './comments.controller';
import { CommentsService } from './comments.service';
import { CommentRepository } from './infrastructure/repository/comment.repository';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../../common/auth/optional-jwt-auth.guard';
import { fakeComment } from './__tests__/fakers/comment.faker';

describe('CommentsController', () => {
  let controller: CommentsController;
  const commentsService = { getCommentsByPost: jest.fn() };
  const commentRepository = { getLikeStats: jest.fn() };
  const comment = fakeComment();

  beforeEach(async () => {
    jest.clearAllMocks();
    commentsService.getCommentsByPost.mockResolvedValue([comment]);
    commentRepository.getLikeStats.mockResolvedValue(
      new Map([[comment.id, { likeCount: 2, likedByMe: true }]]),
    );

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CommentsController],
      providers: [
        { provide: CommentsService, useValue: commentsService },
        { provide: CommentRepository, useValue: commentRepository },
      ],
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
    it('adds likeCount and likedByMe for the signed-in viewer', async () => {
      const response = await controller.getCommentsByPost(
        'viewer-1',
        comment.postId,
      );

      expect(commentRepository.getLikeStats).toHaveBeenCalledWith(
        [comment.id],
        'viewer-1',
      );
      expect(response[0]).toMatchObject({ likeCount: 2, likedByMe: true });
    });

    it('works for an anonymous viewer (no user id)', async () => {
      commentRepository.getLikeStats.mockResolvedValue(
        new Map([[comment.id, { likeCount: 2, likedByMe: false }]]),
      );

      const response = await controller.getCommentsByPost(
        undefined,
        comment.postId,
      );

      expect(commentRepository.getLikeStats).toHaveBeenCalledWith(
        [comment.id],
        undefined,
      );
      expect(response[0]).toMatchObject({ likeCount: 2, likedByMe: false });
    });
  });
});
