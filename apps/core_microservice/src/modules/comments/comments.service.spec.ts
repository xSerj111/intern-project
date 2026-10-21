import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import {
  DatabaseQueryError,
  EntityByIdNotFoundError,
  LoggerKey,
  RoutingKeys,
} from '@repo/shared';
import { OUTBOX_PORT } from '../../common/messaging/outbox.port';
import { USER_DIRECTORY_PORT } from '../profiles/domain/interfaces/user-directory.port';
import { fakePost } from '../posts/__tests__/fakers';
import { fakeComment } from './__tests__/fakers/comment.faker';
import { Comment } from './domain/entities/comment.entity';
import { CommentsService } from './comments.service';
import { COMMENT_REPOSITORY } from './domain/interfaces/comment-repository.port';
import { POST_REPOSITORY } from '../posts/domain/interfaces/post-repository.port';

const POST_AUTHOR = '11111111-1111-1111-1111-111111111111';
const COMMENTER = '22222222-2222-2222-2222-222222222222';
const POST_ID = '00000000-0000-0000-0000-000000000010';

describe('CommentsService', () => {
  let service: CommentsService;
  const tx = { tx: true };
  let commentSave: jest.Mock;
  let commentFindOneByIdOrThrow: jest.Mock;
  let softDeleteWithReplies: jest.Mock;
  let findRootPage: jest.Mock;
  let findRepliesOf: jest.Mock;
  let postFindById: jest.Mock;
  let outbox: { add: jest.Mock };
  let directory: { getUsers: jest.Mock };
  let runInTransaction: jest.Mock;
  let getLikeStats: jest.Mock;
  let logger: { debug: jest.Mock; warn: jest.Mock; error: jest.Mock };

  beforeEach(async () => {
    commentSave = jest.fn((c: Comment) =>
      Promise.resolve(Object.assign(c, { id: 'c-1' })),
    );
    commentFindOneByIdOrThrow = jest.fn(() =>
      Promise.resolve(fakeComment({ id: 'c-1', authorId: COMMENTER })),
    );
    softDeleteWithReplies = jest.fn(() => Promise.resolve());
    findRootPage = jest.fn(() => Promise.resolve([]));
    findRepliesOf = jest.fn(() => Promise.resolve([]));
    runInTransaction = jest.fn((work: (m: typeof tx) => Promise<unknown>) =>
      work(tx),
    );
    getLikeStats = jest.fn();
    logger = { debug: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const commentRepository = {
      findRootPage,
      findRepliesOf,
      save: commentSave,
      findOneByIdOrThrow: commentFindOneByIdOrThrow,
      softDeleteWithReplies,
      runInTransaction,
      getLikeStats,
    };
    postFindById = jest.fn(() =>
      Promise.resolve(fakePost({ id: POST_ID, authorId: POST_AUTHOR })),
    );
    const postRepository = { findById: postFindById };
    outbox = { add: jest.fn(() => Promise.resolve({})) };
    directory = {
      getUsers: jest.fn((ids: string[]) =>
        Promise.resolve(
          new Map(
            ids.map((id) => [
              id,
              {
                userId: id,
                username: 'bob',
                displayName: 'Bob',
                avatarUrl: null,
              },
            ]),
          ),
        ),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CommentsService,
        { provide: LoggerKey, useValue: logger },
        { provide: COMMENT_REPOSITORY, useValue: commentRepository },
        { provide: POST_REPOSITORY, useValue: postRepository },
        { provide: OUTBOX_PORT, useValue: outbox },
        { provide: USER_DIRECTORY_PORT, useValue: directory },
      ],
    }).compile();

    service = module.get<CommentsService>(CommentsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createComment', () => {
    it('writes social.post.commented in the comment transaction for a top-level comment by someone else', async () => {
      const long = 'x'.repeat(300);

      const saved = await service.createComment(COMMENTER, {
        postId: POST_ID,
        content: long,
      });

      expect(commentSave).toHaveBeenCalledWith(expect.any(Comment), tx);
      expect(outbox.add).toHaveBeenCalledTimes(1);
      const [key, payload, manager] = outbox.add.mock.calls[0] as [
        string,
        Record<string, unknown>,
        unknown,
      ];
      expect(key).toBe(RoutingKeys.POST_COMMENTED);
      expect(manager).toBe(tx);
      expect(payload).toMatchObject({
        recipientId: POST_AUTHOR,
        postId: POST_ID,
        commentId: saved.id,
        actor: { userId: COMMENTER, username: 'bob' },
      });
      expect((payload.excerpt as string).length).toBeLessThanOrEqual(140);
    });

    it('reloads the saved comment so the author is joined', async () => {
      const reloaded = fakeComment({ id: 'c-1', authorId: COMMENTER });
      commentFindOneByIdOrThrow.mockResolvedValueOnce(reloaded);

      const result = await service.createComment(COMMENTER, {
        postId: POST_ID,
        content: 'hi',
      });

      expect(commentFindOneByIdOrThrow).toHaveBeenCalledWith('c-1');
      expect(result).toBe(reloaded);
    });

    it('writes no event when the commenter is the post author', async () => {
      await service.createComment(POST_AUTHOR, {
        postId: POST_ID,
        content: 'mine',
      });

      expect(commentSave).toHaveBeenCalledWith(expect.any(Comment), tx);
      expect(outbox.add).not.toHaveBeenCalled();
    });

    it('writes no event for a reply', async () => {
      await service.createComment(COMMENTER, {
        postId: POST_ID,
        parentId: '00000000-0000-0000-0000-000000000099',
        content: 'reply',
      });

      expect(commentSave).toHaveBeenCalledWith(expect.any(Comment), tx);
      expect(outbox.add).not.toHaveBeenCalled();
    });

    it('still saves the comment when the actor has no profile', async () => {
      directory.getUsers.mockResolvedValueOnce(new Map());

      await service.createComment(COMMENTER, {
        postId: POST_ID,
        content: 'hi',
      });

      expect(commentSave).toHaveBeenCalledWith(expect.any(Comment), tx);
      expect(outbox.add).not.toHaveBeenCalled();
    });

    it('throws not-found and writes nothing when the post does not exist', async () => {
      postFindById.mockResolvedValueOnce(null);

      await expect(
        service.createComment(COMMENTER, { postId: POST_ID, content: 'hi' }),
      ).rejects.toThrow(EntityByIdNotFoundError);
      expect(commentSave).not.toHaveBeenCalled();
      expect(outbox.add).not.toHaveBeenCalled();
    });

    it('rethrows a domain error from the transaction unchanged', async () => {
      const domainError = new EntityByIdNotFoundError('Post', POST_ID);
      runInTransaction.mockRejectedValueOnce(domainError);

      await expect(
        service.createComment(COMMENTER, { postId: POST_ID, content: 'hi' }),
      ).rejects.toBe(domainError);
      expect(logger.error).not.toHaveBeenCalled();
    });

    it('maps an unexpected Error from the transaction to DatabaseQueryError and logs it', async () => {
      runInTransaction.mockRejectedValueOnce(new Error('connection lost'));

      await expect(
        service.createComment(COMMENTER, { postId: POST_ID, content: 'hi' }),
      ).rejects.toThrow(DatabaseQueryError);
      expect(logger.error).toHaveBeenCalledWith('connection lost');
    });

    it('maps a non-Error rejection to DatabaseQueryError', async () => {
      runInTransaction.mockRejectedValueOnce('weird');

      await expect(
        service.createComment(COMMENTER, { postId: POST_ID, content: 'hi' }),
      ).rejects.toThrow(DatabaseQueryError);
      expect(logger.error).toHaveBeenCalledWith('weird');
    });
  });

  describe('updateComment', () => {
    it('edits the content and saves for the author', async () => {
      const result = await service.updateComment(COMMENTER, 'c-1', {
        content: '  edited  ',
      });

      expect(commentSave).toHaveBeenCalledWith(
        expect.objectContaining({ content: 'edited' }),
      );
      expect(result.content).toBe('edited');
    });

    it('saves without touching the content when none is given', async () => {
      const result = await service.updateComment(COMMENTER, 'c-1', {});

      expect(result.content).toBe('a faked comment');
      expect(commentSave).toHaveBeenCalledTimes(1);
    });

    it('rejects anyone but the author and saves nothing', async () => {
      await expect(
        service.updateComment(POST_AUTHOR, 'c-1', { content: 'x' }),
      ).rejects.toThrow(ForbiddenException);
      expect(commentSave).not.toHaveBeenCalled();
    });

    it('rejects blank content before saving', async () => {
      await expect(
        service.updateComment(COMMENTER, 'c-1', { content: '   ' }),
      ).rejects.toThrow();
      expect(commentSave).not.toHaveBeenCalled();
    });
  });

  describe('getLikeStats', () => {
    it('delegates to the repository with the viewer', async () => {
      const stats = new Map([['c-1', { likeCount: 2, likedByMe: true }]]);
      getLikeStats.mockResolvedValueOnce(stats);

      const result = await service.getLikeStats(['c-1'], COMMENTER);

      expect(getLikeStats).toHaveBeenCalledWith(['c-1'], COMMENTER);
      expect(result).toBe(stats);
    });

    it('passes an undefined viewer for anonymous reads', async () => {
      await service.getLikeStats(['c-1']);

      expect(getLikeStats).toHaveBeenCalledWith(['c-1'], undefined);
    });
  });

  describe('softDeleteComment', () => {
    it('deletes the comment together with its replies for the author', async () => {
      await service.softDeleteComment(COMMENTER, 'c-1');

      expect(softDeleteWithReplies).toHaveBeenCalledTimes(1);
      expect(softDeleteWithReplies).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'c-1' }),
      );
    });

    it('rejects anyone but the author and deletes nothing', async () => {
      await expect(
        service.softDeleteComment(POST_AUTHOR, 'c-1'),
      ).rejects.toThrow(ForbiddenException);
      expect(softDeleteWithReplies).not.toHaveBeenCalled();
    });
  });

  describe('getCommentsByPost', () => {
    const roots = (n: number) =>
      Array.from({ length: n }, (_, i) => fakeComment({ id: `root-${i}` }));

    it('returns roots first, then their replies, and passes the offset', async () => {
      const reply = fakeComment({ id: 'reply-1', parentId: 'root-0' });
      findRootPage.mockResolvedValue(roots(2));
      findRepliesOf.mockResolvedValue([reply]);

      const page = await service.getCommentsByPost(POST_ID, {
        page: 3,
        limit: 5,
      });

      expect(findRootPage).toHaveBeenCalledWith(POST_ID, {
        offset: 10,
        limit: 5,
      });
      expect(findRepliesOf).toHaveBeenCalledWith(['root-0', 'root-1']);
      expect(page.items.map((c) => c.id)).toEqual([
        'root-0',
        'root-1',
        'reply-1',
      ]);
      expect(page).toMatchObject({ page: 3, limit: 5, hasMore: false });
    });

    it('sets hasMore from the extra root and drops it from the page', async () => {
      findRootPage.mockResolvedValue(roots(3));

      const page = await service.getCommentsByPost(POST_ID, {
        page: 1,
        limit: 2,
      });

      expect(page.hasMore).toBe(true);
      expect(page.items).toHaveLength(2);
      expect(findRepliesOf).toHaveBeenCalledWith(['root-0', 'root-1']);
    });

    it('returns an empty page for a post without comments', async () => {
      const page = await service.getCommentsByPost(POST_ID, {
        page: 1,
        limit: 20,
      });

      expect(page).toEqual({ items: [], page: 1, limit: 20, hasMore: false });
    });
  });

  describe('getAuthors', () => {
    const profile = (authUserId: string, username: string) =>
      ({
        authUserId,
        username,
        displayName: username.toUpperCase(),
        avatarUrl: undefined,
      }) as Comment['author'];

    it('maps the joined authors without a directory call, one entry per author', () => {
      const comments = [
        fakeComment({
          id: 'c-1',
          authorId: COMMENTER,
          author: profile(COMMENTER, 'bob'),
        }),
        fakeComment({
          id: 'c-2',
          authorId: POST_AUTHOR,
          author: profile(POST_AUTHOR, 'amy'),
        }),
        fakeComment({
          id: 'c-3',
          authorId: COMMENTER,
          author: profile(COMMENTER, 'bob'),
        }),
      ];

      const authors = service.getAuthors(comments);

      expect(directory.getUsers).not.toHaveBeenCalled();
      expect([...authors.keys()]).toEqual([COMMENTER, POST_AUTHOR]);
      expect(authors.get(POST_AUTHOR)).toEqual({
        userId: POST_AUTHOR,
        username: 'amy',
        displayName: 'AMY',
        avatarUrl: null,
      });
    });

    it('omits authors whose profile is not joined', () => {
      const authors = service.getAuthors([
        fakeComment({ authorId: COMMENTER, author: undefined }),
      ]);

      expect(authors.size).toBe(0);
    });
  });
});
