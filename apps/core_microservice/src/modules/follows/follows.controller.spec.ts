import { ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PAGE_SIZE_MAX } from '@repo/contracts';
import { OptionalJwtAuthGuard } from '../../common/auth/optional-jwt-auth.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ListFollowsQueryDto } from './dto/list-follows-query.dto';
import { FollowsController } from './follows.controller';
import { FollowsService } from './follows.service';

const USER = '11111111-1111-1111-1111-111111111111';
const VIEWER = '22222222-2222-2222-2222-222222222222';

describe('FollowsController', () => {
  let controller: FollowsController;
  const followsService = { getFollowers: jest.fn(), getFollowing: jest.fn() };
  const page = { items: [], page: 1, limit: 50, hasMore: false };

  beforeEach(async () => {
    jest.clearAllMocks();
    followsService.getFollowers.mockResolvedValue(page);
    followsService.getFollowing.mockResolvedValue(page);

    const module: TestingModule = await Test.createTestingModule({
      controllers: [FollowsController],
      providers: [{ provide: FollowsService, useValue: followsService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(OptionalJwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(FollowsController);
  });

  it('passes the viewer, user and query to getFollowers', async () => {
    const query = Object.assign(new ListFollowsQueryDto(), { page: 2 });

    await expect(controller.getFollowers(VIEWER, USER, query)).resolves.toBe(
      page,
    );
    expect(followsService.getFollowers).toHaveBeenCalledWith(
      USER,
      query,
      VIEWER,
    );
  });

  it('passes an undefined viewer for anonymous getFollowing', async () => {
    const query = new ListFollowsQueryDto();

    await controller.getFollowing(undefined, USER, query);

    expect(followsService.getFollowing).toHaveBeenCalledWith(
      USER,
      query,
      undefined,
    );
  });

  describe('ListFollowsQueryDto validation', () => {
    const pipe = new ValidationPipe({ whitelist: true, transform: true });
    const run = (value: Record<string, string>) =>
      pipe.transform(value, { type: 'query', metatype: ListFollowsQueryDto });

    it('defaults page 1, limit 50', async () => {
      await expect(run({})).resolves.toMatchObject({ page: 1, limit: 50 });
    });

    it('accepts limit at the maximum', async () => {
      await expect(
        run({ limit: String(PAGE_SIZE_MAX) }),
      ).resolves.toMatchObject({ limit: PAGE_SIZE_MAX });
    });

    it.each(['0', '-1', '51', 'abc', '1.5'])('rejects limit=%s', async (v) => {
      await expect(run({ limit: v })).rejects.toThrow();
    });

    it.each(['0', 'x'])('rejects page=%s', async (v) => {
      await expect(run({ page: v })).rejects.toThrow();
    });
  });
});
