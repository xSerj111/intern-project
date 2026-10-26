import { Test, TestingModule } from '@nestjs/testing';
import { HttpStatus } from '@nestjs/common';
import { GUARDS_METADATA, HTTP_CODE_METADATA } from '@nestjs/common/constants';
import type { UserCreatedEvent } from '@repo/shared';
import { InternalTokenGuard } from '../../common/observability/internal-token.guard';
import { AppConfigService } from '../../config/app-config.service';
import { ProfilesService } from '../profiles/profiles.service';
import { InternalEventsController } from './internal-events.controller';

describe('InternalEventsController', () => {
  let controller: InternalEventsController;
  const profiles = { createProfile: jest.fn() };
  const event = {
    authUserId: '11111111-1111-1111-1111-111111111111',
    handle: 'amy',
    email: 'amy@example.com',
  } as unknown as UserCreatedEvent;

  beforeEach(async () => {
    jest.resetAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [InternalEventsController],
      providers: [
        { provide: ProfilesService, useValue: profiles },
        { provide: AppConfigService, useValue: { internalApiToken: 'x' } },
      ],
    }).compile();

    controller = module.get(InternalEventsController);
  });

  it('creates a profile from the user-created event', async () => {
    profiles.createProfile.mockResolvedValue(undefined);

    await expect(controller.handleUserCreated(event)).resolves.toBeUndefined();

    expect(profiles.createProfile).toHaveBeenCalledWith(
      event.authUserId,
      event.handle,
    );
  });

  it('propagates profile creation failures to the caller', async () => {
    profiles.createProfile.mockRejectedValue(new Error('db down'));

    await expect(controller.handleUserCreated(event)).rejects.toThrow(
      'db down',
    );
  });

  it('answers 200 rather than 201', () => {
    const proto = InternalEventsController.prototype as unknown as Record<
      string,
      object
    >;
    const code = Reflect.getMetadata(
      HTTP_CODE_METADATA,
      proto.handleUserCreated,
    ) as number;

    expect(code).toBe(HttpStatus.OK);
  });

  it('is protected by the internal token guard', () => {
    const proto = InternalEventsController.prototype as unknown as Record<
      string,
      object
    >;
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      proto.handleUserCreated,
    ) as unknown[];

    expect(guards).toContain(InternalTokenGuard);
  });
});
