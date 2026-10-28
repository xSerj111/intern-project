import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Test, TestingModule } from '@nestjs/testing';
import { ProfilesController, UsersByIdsQueryDto } from './profiles.controller';
import { ProfilesService } from './profiles.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

describe('ProfilesController', () => {
  let controller: ProfilesController;
  const service = { searchProfiles: jest.fn(), getUsersByIds: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProfilesController],
      providers: [{ provide: ProfilesService, useValue: service }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<ProfilesController>(ProfilesController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('searchProfiles delegates with the caller id excluded', async () => {
    const users = [
      { userId: 'u2', username: 'bob', displayName: 'Bob', avatarUrl: null },
    ];
    service.searchProfiles.mockResolvedValue(users);

    const result = await controller.searchProfiles({ q: 'bo', limit: 5 }, 'u1');

    expect(service.searchProfiles).toHaveBeenCalledWith('bo', 5, 'u1');
    expect(result).toBe(users);
  });

  it('declares search before :id so the route is not shadowed', () => {
    const proto = ProfilesController.prototype as unknown as Record<
      string,
      unknown
    >;
    const names = Object.getOwnPropertyNames(proto);
    expect(names.indexOf('searchProfiles')).toBeLessThan(
      names.indexOf('getProfile'),
    );
  });

  it('getUsersByIds delegates the ids to the service', async () => {
    const users = [
      { userId: 'u2', username: 'bob', displayName: 'Bob', avatarUrl: null },
    ];
    service.getUsersByIds.mockResolvedValue(users);

    const result = await controller.getUsersByIds({ ids: ['u2'] });

    expect(service.getUsersByIds).toHaveBeenCalledWith(['u2']);
    expect(result).toBe(users);
  });

  it('declares by-users before :id so the route is not shadowed', () => {
    const names = Object.getOwnPropertyNames(ProfilesController.prototype);
    expect(names.indexOf('getUsersByIds')).toBeLessThan(
      names.indexOf('getProfile'),
    );
  });

  describe('UsersByIdsQueryDto', () => {
    const A = '3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e';
    const B = '9a1c2d3e-4f5a-4b6c-8d7e-0f1a2b3c4d5e';
    const run = (ids: unknown) => {
      const dto = plainToInstance(UsersByIdsQueryDto, { ids });
      return validate(dto).then((errors) => ({ dto, errors }));
    };

    it('splits, trims and de-duplicates comma-separated ids', async () => {
      const { dto, errors } = await run(`${A}, ${B},${A}`);
      expect(errors).toHaveLength(0);
      expect(dto.ids).toEqual([A, B]);
    });

    it('rejects non-UUID ids', async () => {
      expect((await run(`${A},nope`)).errors).not.toHaveLength(0);
    });

    it('rejects an empty list', async () => {
      expect((await run('')).errors).not.toHaveLength(0);
    });

    it('rejects more than 100 distinct ids', async () => {
      const ids = Array.from(
        { length: 101 },
        (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      );
      expect((await run(ids.join(','))).errors).not.toHaveLength(0);
      expect((await run(ids.slice(0, 100).join(','))).errors).toHaveLength(0);
    });
  });
});
