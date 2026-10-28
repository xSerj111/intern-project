import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { NotificationPreferences } from './domain/entities/notification-preferences.entity';
import { UpdatePreferencesDto } from './dto/update-preferences.dto';
import { PreferencesController } from './preferences.controller';
import { PreferencesService } from './preferences.service';

const USER = '11111111-1111-4111-8111-111111111111';

describe('PreferencesService', () => {
  let repo: { findByUserId: jest.Mock; save: jest.Mock };
  let service: PreferencesService;

  beforeEach(() => {
    repo = {
      findByUserId: jest.fn((id: string) =>
        Promise.resolve(NotificationPreferences.defaults(id)),
      ),
      save: jest.fn((p: NotificationPreferences) => Promise.resolve(p)),
    };
    service = new PreferencesService(repo);
  });

  it('returns all-on defaults when no row exists', async () => {
    await expect(service.get(USER)).resolves.toEqual({
      emailMessages: true,
      emailComments: true,
      emailLikes: true,
      emailFollows: true,
    });
    expect(repo.findByUserId).toHaveBeenCalledWith(USER);
  });

  it('saves the supplied switches for the caller', async () => {
    const result = await service.update(USER, {
      emailMessages: false,
      emailComments: true,
      emailLikes: false,
      emailFollows: true,
    });

    expect(result).toEqual({
      emailMessages: false,
      emailComments: true,
      emailLikes: false,
      emailFollows: true,
    });
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER, emailMessages: false }),
    );
  });

  it('controller delegates with the caller id', async () => {
    const svc = { get: jest.fn(), update: jest.fn() };
    const controller = new PreferencesController(
      svc as unknown as PreferencesService,
    );
    const body = plainToInstance(UpdatePreferencesDto, {
      emailMessages: true,
      emailComments: true,
      emailLikes: true,
      emailFollows: false,
    });
    await controller.get(USER);
    await controller.update(USER, body);
    expect(svc.get).toHaveBeenCalledWith(USER);
    expect(svc.update).toHaveBeenCalledWith(USER, body);
  });

  describe('UpdatePreferencesDto', () => {
    it('requires all four booleans', async () => {
      const full = {
        emailMessages: true,
        emailComments: true,
        emailLikes: true,
        emailFollows: true,
      };
      expect(
        await validate(plainToInstance(UpdatePreferencesDto, full)),
      ).toHaveLength(0);
      expect(
        (
          await validate(
            plainToInstance(UpdatePreferencesDto, {
              ...full,
              emailLikes: undefined,
            }),
          )
        ).length,
      ).toBeGreaterThan(0);
      expect(
        (
          await validate(
            plainToInstance(UpdatePreferencesDto, {
              ...full,
              emailLikes: 'no',
            }),
          )
        ).length,
      ).toBeGreaterThan(0);
    });
  });
});
