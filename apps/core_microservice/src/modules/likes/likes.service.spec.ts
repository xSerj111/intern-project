import { Test } from '@nestjs/testing';
import { EntityByIdNotFoundError, LoggerKey, RoutingKeys } from '@repo/shared';
import { OUTBOX_PORT } from '../../common/messaging/outbox.port';
import { COMMENT_REPOSITORY } from '../comments/domain/interfaces/comment-repository.port';
import { POST_REPOSITORY } from '../posts/domain/interfaces/post-repository.port';
import { USER_DIRECTORY_PORT } from '../profiles/domain/interfaces/user-directory.port';
import { COMMENT_LIKE_REPOSITORY } from './domain/interfaces/comment-like-repository.port';
import { POST_LIKE_REPOSITORY } from './domain/interfaces/post-like-repository.port';
import { LikesService } from './likes.service';

const LIKER = '11111111-1111-4111-8111-111111111111';
const AUTHOR = '22222222-2222-4222-8222-222222222222';
const POST_ID = '33333333-3333-4333-8333-333333333333';
const COMMENT_ID = '44444444-4444-4444-8444-444444444444';

describe('LikesService', () => {
  let service: LikesService;
  /** Ordered log of the calls whose relative order matters. */
  let order: string[];
  const tx = { tx: true };

  // Entities are mocked: their rules are covered by the entity specs.
  const post = {
    id: POST_ID,
    authorId: AUTHOR,
    assertLikeableBy: jest.fn(),
    notifiesAuthorOfLikeBy: jest.fn(),
    excerpt: jest.fn(),
  };
  const comment = {
    id: COMMENT_ID,
    postId: POST_ID,
    authorId: AUTHOR,
    assertLikeableBy: jest.fn(),
    notifiesAuthorOfLikeBy: jest.fn(),
    excerpt: jest.fn(),
  };

  const postRepo = { findOneByIdOrThrow: jest.fn() };
  const commentRepo = { findOneByIdOrThrow: jest.fn() };
  const runInTransaction = jest.fn(
    async (work: (m: unknown) => Promise<unknown>) => work(tx),
  );
  const postLikes = {
    like: jest.fn(),
    unlike: jest.fn(),
    count: jest.fn(),
    likedBy: jest.fn(),
    runInTransaction,
  };
  const commentLikes = {
    like: jest.fn(),
    unlike: jest.fn(),
    count: jest.fn(),
    likedBy: jest.fn(),
    runInTransaction,
  };
  const directory = { getUsers: jest.fn(), assertUsersExist: jest.fn() };
  const outbox = { add: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    order = [];

    post.assertLikeableBy.mockImplementation(() => order.push('assert'));
    post.notifiesAuthorOfLikeBy.mockReturnValue(true);
    post.excerpt.mockReturnValue('post excerpt');
    comment.assertLikeableBy.mockImplementation(() => order.push('assert'));
    comment.notifiesAuthorOfLikeBy.mockReturnValue(true);
    comment.excerpt.mockReturnValue('comment excerpt');

    postRepo.findOneByIdOrThrow.mockResolvedValue(post);
    commentRepo.findOneByIdOrThrow.mockResolvedValue(comment);
    postLikes.like.mockImplementation(() => {
      order.push('insert');
      return Promise.resolve({ inserted: true });
    });
    commentLikes.like.mockImplementation(() => {
      order.push('insert');
      return Promise.resolve({ inserted: true });
    });
    postLikes.unlike.mockResolvedValue(false);
    commentLikes.unlike.mockResolvedValue(false);
    postLikes.count.mockResolvedValue(3);
    commentLikes.count.mockResolvedValue(2);
    directory.getUsers.mockResolvedValue(
      new Map([
        [
          LIKER,
          {
            userId: LIKER,
            username: 'liker',
            displayName: 'Li Ker',
            avatarUrl: null,
          },
        ],
      ]),
    );
    outbox.add.mockResolvedValue({});

    const module = await Test.createTestingModule({
      providers: [
        LikesService,
        { provide: POST_REPOSITORY, useValue: postRepo },
        { provide: COMMENT_REPOSITORY, useValue: commentRepo },
        { provide: POST_LIKE_REPOSITORY, useValue: postLikes },
        { provide: COMMENT_LIKE_REPOSITORY, useValue: commentLikes },
        { provide: USER_DIRECTORY_PORT, useValue: directory },
        { provide: OUTBOX_PORT, useValue: outbox },
        {
          provide: LoggerKey,
          useValue: { debug: jest.fn(), info: jest.fn(), error: jest.fn() },
        },
      ],
    }).compile();

    service = module.get(LikesService);
  });

  describe('likePost', () => {
    it('checks visibility before inserting', async () => {
      await service.likePost(POST_ID, LIKER);

      expect(order).toEqual(['assert', 'insert']);
      expect(post.assertLikeableBy).toHaveBeenCalledWith(LIKER);
    });

    it('does not insert when the post is not likeable', async () => {
      post.assertLikeableBy.mockImplementation(() => {
        throw new EntityByIdNotFoundError('Post', POST_ID);
      });

      await expect(service.likePost(POST_ID, LIKER)).rejects.toThrow(
        EntityByIdNotFoundError,
      );
      expect(postLikes.like).not.toHaveBeenCalled();
      expect(outbox.add).not.toHaveBeenCalled();
    });

    it('writes one social.post.liked outbox row in the same transaction on a first-ever like', async () => {
      const state = await service.likePost(POST_ID, LIKER);

      expect(state).toEqual({ liked: true, likeCount: 3 });
      expect(postLikes.like).toHaveBeenCalledWith(POST_ID, LIKER, tx);
      expect(outbox.add).toHaveBeenCalledTimes(1);
      expect(outbox.add).toHaveBeenCalledWith(
        RoutingKeys.POST_LIKED,
        {
          actor: {
            userId: LIKER,
            username: 'liker',
            displayName: 'Li Ker',
            avatarUrl: null,
          },
          recipientId: AUTHOR,
          postId: POST_ID,
          excerpt: 'post excerpt',
        },
        tx,
      );
    });

    it('writes no outbox row on a restore or repeat like (inserted = false)', async () => {
      postLikes.like.mockResolvedValue({ inserted: false });

      const state = await service.likePost(POST_ID, LIKER);

      expect(state).toEqual({ liked: true, likeCount: 3 });
      expect(outbox.add).not.toHaveBeenCalled();
    });

    it('writes no outbox row when the entity says the author is not notified', async () => {
      post.notifiesAuthorOfLikeBy.mockReturnValue(false);

      await service.likePost(POST_ID, AUTHOR);

      expect(post.notifiesAuthorOfLikeBy).toHaveBeenCalledWith(AUTHOR);
      expect(outbox.add).not.toHaveBeenCalled();
    });

    it('still likes when the liker has no profile yet', async () => {
      directory.getUsers.mockResolvedValue(new Map());

      await service.likePost(POST_ID, LIKER);

      expect(outbox.add).toHaveBeenCalledTimes(1);
    });
  });

  describe('unlikePost', () => {
    it('is a no-op returning liked: false when the post was not liked', async () => {
      const state = await service.unlikePost(POST_ID, LIKER);

      expect(state).toEqual({ liked: false, likeCount: 3 });
      expect(postLikes.unlike).toHaveBeenCalledWith(POST_ID, LIKER);
      expect(outbox.add).not.toHaveBeenCalled();
    });

    it('emits nothing when it removes a like', async () => {
      postLikes.unlike.mockResolvedValue(true);

      await service.unlikePost(POST_ID, LIKER);

      expect(outbox.add).not.toHaveBeenCalled();
    });

    it('propagates not-found for a missing post', async () => {
      postRepo.findOneByIdOrThrow.mockRejectedValue(
        new EntityByIdNotFoundError('Post', POST_ID),
      );

      await expect(service.unlikePost(POST_ID, LIKER)).rejects.toThrow(
        EntityByIdNotFoundError,
      );
      expect(postLikes.unlike).not.toHaveBeenCalled();
    });
  });

  describe('likeComment', () => {
    it('checks visibility against the comment post before inserting', async () => {
      await service.likeComment(COMMENT_ID, LIKER);

      expect(postRepo.findOneByIdOrThrow).toHaveBeenCalledWith(POST_ID);
      expect(comment.assertLikeableBy).toHaveBeenCalledWith(LIKER, post);
      expect(order).toEqual(['assert', 'insert']);
    });

    it('writes one social.comment.liked outbox row in the same transaction on a first-ever like', async () => {
      const state = await service.likeComment(COMMENT_ID, LIKER);

      expect(state).toEqual({ liked: true, likeCount: 2 });
      expect(commentLikes.like).toHaveBeenCalledWith(COMMENT_ID, LIKER, tx);
      expect(outbox.add).toHaveBeenCalledTimes(1);
      expect(outbox.add).toHaveBeenCalledWith(
        RoutingKeys.COMMENT_LIKED,
        {
          actor: {
            userId: LIKER,
            username: 'liker',
            displayName: 'Li Ker',
            avatarUrl: null,
          },
          recipientId: AUTHOR,
          postId: POST_ID,
          commentId: COMMENT_ID,
          excerpt: 'comment excerpt',
        },
        tx,
      );
    });

    it('writes no outbox row on a restore (inserted = false)', async () => {
      commentLikes.like.mockResolvedValue({ inserted: false });

      await service.likeComment(COMMENT_ID, LIKER);

      expect(outbox.add).not.toHaveBeenCalled();
    });

    it('writes no outbox row when the comment author liked their own comment', async () => {
      comment.notifiesAuthorOfLikeBy.mockReturnValue(false);

      await service.likeComment(COMMENT_ID, AUTHOR);

      expect(outbox.add).not.toHaveBeenCalled();
    });

    it('does not insert when the comment is not likeable', async () => {
      comment.assertLikeableBy.mockImplementation(() => {
        throw new EntityByIdNotFoundError('Post', POST_ID);
      });

      await expect(service.likeComment(COMMENT_ID, LIKER)).rejects.toThrow(
        EntityByIdNotFoundError,
      );
      expect(commentLikes.like).not.toHaveBeenCalled();
    });
  });

  describe('unlikeComment', () => {
    it('is a no-op returning liked: false when the comment was not liked', async () => {
      const state = await service.unlikeComment(COMMENT_ID, LIKER);

      expect(state).toEqual({ liked: false, likeCount: 2 });
      expect(commentLikes.unlike).toHaveBeenCalledWith(COMMENT_ID, LIKER);
      expect(outbox.add).not.toHaveBeenCalled();
    });
  });
});
