import { Test, TestingModule } from '@nestjs/testing';
import { LoggerKey, RoutingKeys } from '@repo/shared';
import { DataSource } from 'typeorm';
import { OUTBOX_PORT } from '../../common/messaging/outbox.port';
import { USER_DIRECTORY_PORT } from '../profiles/domain/interfaces/user-directory.port';
import { Follow } from './domain/entities/follow.entity';
import { FollowsService } from './follows.service';
import { FollowRepository } from './infrastructure/repository/follow.repository';

const FOLLOWER = '11111111-1111-1111-1111-111111111111';
const FOLLOWED = '22222222-2222-2222-2222-222222222222';

describe('FollowsService', () => {
  let service: FollowsService;
  let repo: { findByFollowerAndFollowing: jest.Mock };
  let tx: { getRepository: jest.Mock };
  let txSave: jest.Mock;
  let outbox: { add: jest.Mock };
  let directory: { getUsers: jest.Mock };

  beforeEach(async () => {
    repo = { findByFollowerAndFollowing: jest.fn(() => Promise.resolve(null)) };
    txSave = jest.fn((f: Follow) =>
      Promise.resolve(Object.assign(f, { id: 'f-1' })),
    );
    tx = { getRepository: jest.fn(() => ({ save: txSave })) };
    const dataSource = {
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
        { provide: FollowRepository, useValue: repo },
        { provide: DataSource, useValue: dataSource },
        { provide: OUTBOX_PORT, useValue: outbox },
        { provide: USER_DIRECTORY_PORT, useValue: directory },
      ],
    }).compile();

    service = module.get(FollowsService);
  });

  it('writes social.user.followed in the follow transaction for a new follow', async () => {
    await service.follow(FOLLOWER, FOLLOWED);

    expect(txSave).toHaveBeenCalledTimes(1);
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
});
