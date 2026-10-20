import { Test, TestingModule } from '@nestjs/testing';
import { LoggerKey, RoutingKeys } from '@repo/shared';
import { OUTBOX_PORT } from '../../common/messaging/outbox.port';
import { USER_DIRECTORY_PORT } from '../profiles/domain/interfaces/user-directory.port';
import { Follow } from './domain/entities/follow.entity';
import { FollowsService } from './follows.service';
import { FollowRepositoryKey } from './domain/interfaces/follow-repository.port';

const FOLLOWER = '11111111-1111-1111-1111-111111111111';
const FOLLOWED = '22222222-2222-2222-2222-222222222222';

describe('FollowsService', () => {
  let service: FollowsService;
  let repo: {
    findByFollowerAndFollowing: jest.Mock;
    findFollowers: jest.Mock;
    findFollowing: jest.Mock;
    findFollowedAmong: jest.Mock;
    save: jest.Mock;
    runInTransaction: jest.Mock;
  };
  const tx = { tx: true };
  let txSave: jest.Mock;
  let outbox: { add: jest.Mock };
  let directory: { getUsers: jest.Mock };

  beforeEach(async () => {
    txSave = jest.fn((f: Follow) =>
      Promise.resolve(Object.assign(f, { id: 'f-1' })),
    );
    repo = {
      findByFollowerAndFollowing: jest.fn(() => Promise.resolve(null)),
      findFollowers: jest.fn(() => Promise.resolve([])),
      findFollowing: jest.fn(() => Promise.resolve([])),
      findFollowedAmong: jest.fn(() => Promise.resolve(new Set<string>())),
      save: txSave,
      runInTransaction: jest.fn((work: (m: typeof tx) => Promise<unknown>) =>
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
                username: 'amy',
                displayName: 'Amy',
                avatarUrl: null,
              },
            ]),
          ),
        ),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FollowsService,
        {
          provide: LoggerKey,
          useValue: { debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
        },
        { provide: FollowRepositoryKey, useValue: repo },
        { provide: OUTBOX_PORT, useValue: outbox },
        { provide: USER_DIRECTORY_PORT, useValue: directory },
      ],
    }).compile();

    service = module.get(FollowsService);
  });

  it('writes social.user.followed in the follow transaction for a new follow', async () => {
    await service.follow(FOLLOWER, FOLLOWED);

    expect(txSave).toHaveBeenCalledWith(expect.any(Follow), tx);
    expect(outbox.add).toHaveBeenCalledTimes(1);
    const [key, payload, manager] = outbox.add.mock.calls[0] as [
      string,
      unknown,
      unknown,
    ];
    expect(key).toBe(RoutingKeys.USER_FOLLOWED);
    expect(manager).toBe(tx);
    expect(payload).toMatchObject({
      recipientId: FOLLOWED,
      actor: { userId: FOLLOWER, username: 'amy' },
    });
  });

  it('writes nothing when the follow already exists', async () => {
    repo.findByFollowerAndFollowing.mockResolvedValueOnce(
      Follow.create({ followerId: FOLLOWER, followingId: FOLLOWED }),
    );

    await service.follow(FOLLOWER, FOLLOWED);

    expect(txSave).not.toHaveBeenCalled();
    expect(outbox.add).not.toHaveBeenCalled();
  });

  it('saves a self-follow without an event', async () => {
    await service.follow(FOLLOWER, FOLLOWER);

    expect(txSave).toHaveBeenCalledTimes(1);
    expect(outbox.add).not.toHaveBeenCalled();
  });

  it('still saves the follow when the actor has no profile', async () => {
    directory.getUsers.mockResolvedValueOnce(new Map());

    await service.follow(FOLLOWER, FOLLOWED);

    expect(txSave).toHaveBeenCalledTimes(1);
    expect(outbox.add).not.toHaveBeenCalled();
  });

  describe('list pages', () => {
    const edge = (n: number, followerId: string, followingId: string) =>
      Object.assign(Follow.create({ followerId, followingId }), {
        id: `f-${n}`,
        createdAt: new Date('2026-01-01T00:00:00Z'),
      });

    it('asks for offset (page-1)*limit and drops the extra row into hasMore', async () => {
      repo.findFollowers.mockResolvedValueOnce([
        edge(1, 'a', FOLLOWED),
        edge(2, 'b', FOLLOWED),
        edge(3, 'c', FOLLOWED),
      ]);

      const page = await service.getFollowers(
        FOLLOWED,
        { page: 3, limit: 2 },
        FOLLOWER,
      );

      expect(repo.findFollowers).toHaveBeenCalledWith(FOLLOWED, {
        offset: 4,
        limit: 2,
      });
      expect(page).toMatchObject({ page: 3, limit: 2, hasMore: true });
      expect(page.items.map((i) => i.id)).toEqual(['f-1', 'f-2']);
    });

    it('reports hasMore false on a short page', async () => {
      repo.findFollowing.mockResolvedValueOnce([edge(1, FOLLOWED, 'x')]);

      const page = await service.getFollowing(FOLLOWED, {}, FOLLOWER);

      expect(repo.findFollowing).toHaveBeenCalledWith(FOLLOWED, {
        offset: 0,
        limit: 50,
      });
      expect(page.hasMore).toBe(false);
    });

    it('marks followers the viewer follows, with one batched lookup', async () => {
      repo.findFollowers.mockResolvedValueOnce([
        edge(1, 'a', FOLLOWED),
        edge(2, 'b', FOLLOWED),
      ]);
      repo.findFollowedAmong.mockResolvedValueOnce(new Set(['b']));

      const page = await service.getFollowers(FOLLOWED, {}, FOLLOWER);

      expect(repo.findFollowedAmong).toHaveBeenCalledTimes(1);
      expect(repo.findFollowedAmong).toHaveBeenCalledWith(FOLLOWER, ['a', 'b']);
      expect(page.items.map((i) => i.isFollowedByMe)).toEqual([false, true]);
    });

    it('checks the followed side for the following list', async () => {
      repo.findFollowing.mockResolvedValueOnce([edge(1, FOLLOWED, 'x')]);
      repo.findFollowedAmong.mockResolvedValueOnce(new Set(['x']));

      const page = await service.getFollowing(FOLLOWED, {}, FOLLOWER);

      expect(repo.findFollowedAmong).toHaveBeenCalledWith(FOLLOWER, ['x']);
      expect(page.items[0].isFollowedByMe).toBe(true);
    });

    it('skips the lookup and returns false for anonymous viewers', async () => {
      repo.findFollowers.mockResolvedValueOnce([edge(1, 'a', FOLLOWED)]);

      const page = await service.getFollowers(FOLLOWED, {});

      expect(repo.findFollowedAmong).not.toHaveBeenCalled();
      expect(page.items[0]).toMatchObject({
        followerId: 'a',
        followingId: FOLLOWED,
        createdAt: '2026-01-01T00:00:00.000Z',
        isFollowedByMe: false,
      });
    });
  });
});
