import { Test, TestingModule } from '@nestjs/testing';
import { EntityByIdNotFoundError, LoggerKey, RoutingKeys } from '@repo/shared';
import { DataSource } from 'typeorm';
import { OUTBOX_PORT } from '../../common/messaging/outbox.port';
import { USER_DIRECTORY_PORT } from '../profiles/domain/interfaces/user-directory.port';
import { fakePost } from '../posts/__tests__/fakers';
import { Comment } from './domain/entities/comment.entity';
import { CommentsService } from './comments.service';
import { CommentRepository } from './infrastructure/repository/comment.repository';

const POST_AUTHOR = '11111111-1111-1111-1111-111111111111';
const COMMENTER = '22222222-2222-2222-2222-222222222222';
const POST_ID = '00000000-0000-0000-0000-000000000010';

describe('CommentsService', () => {
  let service: CommentsService;
  let tx: { getRepository: jest.Mock };
  let txSave: jest.Mock;
  let postFindOne: jest.Mock;
  let outbox: { add: jest.Mock };
  let directory: { getUsers: jest.Mock };

  beforeEach(async () => {
    txSave = jest.fn((c: Comment) =>
      Promise.resolve(Object.assign(c, { id: 'c-1' })),
    );
    tx = { getRepository: jest.fn(() => ({ save: txSave })) };
    postFindOne = jest.fn(() =>
      Promise.resolve(fakePost({ id: POST_ID, authorId: POST_AUTHOR })),
    );
    const dataSource = {
      getRepository: jest.fn(() => ({ findOne: postFindOne })),
      transaction: jest.fn((work: (m: typeof tx) => Promise<unknown>) =>
        work(tx),
      ),
    };
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
        {
          provide: LoggerKey,
          useValue: { debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
        },
        { provide: CommentRepository, useValue: {} },
        { provide: DataSource, useValue: dataSource },
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

      expect(txSave).toHaveBeenCalledTimes(1);
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

    it('writes no event when the commenter is the post author', async () => {
      await service.createComment(POST_AUTHOR, {
        postId: POST_ID,
        content: 'mine',
      });

      expect(txSave).toHaveBeenCalledTimes(1);
      expect(outbox.add).not.toHaveBeenCalled();
    });

    it('writes no event for a reply', async () => {
      await service.createComment(COMMENTER, {
        postId: POST_ID,
        parentId: '00000000-0000-0000-0000-000000000099',
        content: 'reply',
      });

      expect(txSave).toHaveBeenCalledTimes(1);
      expect(outbox.add).not.toHaveBeenCalled();
    });

    it('still saves the comment when the actor has no profile', async () => {
      directory.getUsers.mockResolvedValueOnce(new Map());

      await service.createComment(COMMENTER, {
        postId: POST_ID,
        content: 'hi',
      });

      expect(txSave).toHaveBeenCalledTimes(1);
      expect(outbox.add).not.toHaveBeenCalled();
    });

    it('throws not-found and writes nothing when the post does not exist', async () => {
      postFindOne.mockResolvedValueOnce(null);

      await expect(
        service.createComment(COMMENTER, { postId: POST_ID, content: 'hi' }),
      ).rejects.toThrow(EntityByIdNotFoundError);
      expect(txSave).not.toHaveBeenCalled();
      expect(outbox.add).not.toHaveBeenCalled();
    });
  });
});
