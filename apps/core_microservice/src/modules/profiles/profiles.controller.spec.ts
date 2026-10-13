import { Test, TestingModule } from '@nestjs/testing';
import { ProfilesController } from './profiles.controller';
import { ProfilesService } from './profiles.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

describe('ProfilesController', () => {
  let controller: ProfilesController;
  const service = { searchProfiles: jest.fn() };

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
});
