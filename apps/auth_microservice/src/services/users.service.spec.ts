// env.ts fails fast on these at import time, so set them before anything loads it.
process.env.CORE_SERVICE_URL = 'http://localhost:3001';
process.env.AUTH_ALLOWED_ORIGINS = 'http://localhost:3000';
process.env.INTERNAL_API_TOKEN = 'x'.repeat(32);

import { UniqueConstraintViolationError, UserCreatedEvent } from '@repo/shared';
import type { WinstonLogger } from '@repo/shared';
import { UsersService } from './users.service';
import { AuthUser } from '../domain/entities/auth-user.entity';
import { IAuthUserRepository } from '../domain/interfaces/auth-user-repository.interface';

const makeUser = (overrides: Partial<AuthUser> = {}): AuthUser =>
  Object.assign(new AuthUser(), {
    id: 'user-1',
    email: 'jane.doe@example.com',
    passwordHash: 'hashed-pw',
    isEmailVerified: false,
    ...overrides,
  });

describe('UsersService', () => {
  let repo: { findByEmail: jest.Mock; save: jest.Mock; findOneByIdOrThrow: jest.Mock };
  let logger: { debug: jest.Mock };
  let crypto: { hash: jest.Mock; compare: jest.Mock };
  let publisher: { publishUserCreatedEvent: jest.Mock };
  let service: UsersService;

  beforeEach(() => {
    repo = {
      findByEmail: jest.fn(),
      save: jest.fn((u: AuthUser) => Promise.resolve(u)),
      findOneByIdOrThrow: jest.fn(),
    };
    logger = { debug: jest.fn() };
    crypto = { hash: jest.fn().mockResolvedValue('hashed-pw'), compare: jest.fn() };
    publisher = { publishUserCreatedEvent: jest.fn() };
    service = new UsersService(
      repo as unknown as IAuthUserRepository,
      logger as unknown as WinstonLogger,
      crypto,
      publisher,
    );
  });

  describe('registerUser', () => {
    it('rejects an email that is already registered, without hashing or saving', async () => {
      repo.findByEmail.mockResolvedValue(makeUser());

      await expect(service.registerUser('jane.doe@example.com', 'pw')).rejects.toThrow(
        UniqueConstraintViolationError,
      );
      expect(crypto.hash).not.toHaveBeenCalled();
      expect(repo.save).not.toHaveBeenCalled();
      expect(publisher.publishUserCreatedEvent).not.toHaveBeenCalled();
    });

    it('hashes the password and saves an unverified user', async () => {
      repo.findByEmail.mockResolvedValue(null);
      repo.save.mockImplementation((u: AuthUser) =>
        Promise.resolve(Object.assign(u, { id: 'user-9' })),
      );

      await service.registerUser('jane.doe@example.com', 'plain-pw');

      expect(crypto.hash).toHaveBeenCalledWith('plain-pw');
      const saved = (repo.save.mock.calls as [AuthUser][])[0][0];
      expect(saved).toMatchObject({
        email: 'jane.doe@example.com',
        passwordHash: 'hashed-pw',
        isEmailVerified: false,
      });
    });

    it('publishes UserCreatedEvent with the email local part as default handle', async () => {
      repo.findByEmail.mockResolvedValue(null);
      repo.save.mockImplementation((u: AuthUser) =>
        Promise.resolve(Object.assign(u, { id: 'user-9' })),
      );

      await service.registerUser('jane.doe@example.com', 'pw');

      expect(publisher.publishUserCreatedEvent).toHaveBeenCalledTimes(1);
      const event = (
        publisher.publishUserCreatedEvent.mock.calls as [UserCreatedEvent][]
      )[0][0];
      expect(event).toBeInstanceOf(UserCreatedEvent);
      expect(event).toMatchObject({
        authUserId: 'user-9',
        email: 'jane.doe@example.com',
        handle: 'jane.doe',
      });
      expect(event.timestamp).toBeInstanceOf(Date);
    });

    it('never returns the password hash', async () => {
      repo.findByEmail.mockResolvedValue(null);
      repo.save.mockResolvedValue(makeUser());

      const result = await service.registerUser('jane.doe@example.com', 'pw');

      expect(result).not.toHaveProperty('passwordHash');
      expect(result).toMatchObject({ id: 'user-1', email: 'jane.doe@example.com' });
    });

    it('does not publish when saving fails', async () => {
      repo.findByEmail.mockResolvedValue(null);
      repo.save.mockRejectedValue(new Error('db down'));

      await expect(service.registerUser('a@b.com', 'pw')).rejects.toThrow('db down');
      expect(publisher.publishUserCreatedEvent).not.toHaveBeenCalled();
    });
  });

  describe('getUserById', () => {
    it('returns the user without the password hash', async () => {
      repo.findOneByIdOrThrow.mockResolvedValue(makeUser());

      const result = await service.getUserById('user-1');

      expect(repo.findOneByIdOrThrow).toHaveBeenCalledWith('user-1');
      expect(result).not.toHaveProperty('passwordHash');
      expect(result.email).toBe('jane.doe@example.com');
    });

    it('propagates the repository error for an unknown id', async () => {
      repo.findOneByIdOrThrow.mockRejectedValue(new Error('not found'));

      await expect(service.getUserById('nope')).rejects.toThrow('not found');
    });
  });

  describe('findByEmailWithPassword', () => {
    it('returns the full user including the hash', async () => {
      const user = makeUser();
      repo.findByEmail.mockResolvedValue(user);

      await expect(service.findByEmailWithPassword(user.email)).resolves.toBe(user);
      expect(repo.findByEmail).toHaveBeenCalledWith(user.email);
    });

    it('returns null when no user matches', async () => {
      repo.findByEmail.mockResolvedValue(null);

      await expect(service.findByEmailWithPassword('x@y.com')).resolves.toBeNull();
    });
  });

  describe('findOrCreateByGoogle', () => {
    it('links the Google id to an existing local user and marks the email verified', async () => {
      const existing = makeUser({ googleId: undefined, isEmailVerified: false });
      repo.findByEmail.mockResolvedValue(existing);

      const result = await service.findOrCreateByGoogle(existing.email, 'g-123');

      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({ googleId: 'g-123', isEmailVerified: true }),
      );
      expect(result.googleId).toBe('g-123');
      expect(publisher.publishUserCreatedEvent).not.toHaveBeenCalled();
    });

    it('returns an already linked user untouched', async () => {
      const existing = makeUser({ googleId: 'g-123', isEmailVerified: true });
      repo.findByEmail.mockResolvedValue(existing);

      const result = await service.findOrCreateByGoogle(existing.email, 'g-123');

      expect(result).toBe(existing);
      expect(repo.save).not.toHaveBeenCalled();
      expect(publisher.publishUserCreatedEvent).not.toHaveBeenCalled();
    });

    it('creates a verified password-less user and publishes UserCreatedEvent', async () => {
      repo.findByEmail.mockResolvedValue(null);
      repo.save.mockImplementation((u: AuthUser) =>
        Promise.resolve(Object.assign(u, { id: 'user-g' })),
      );

      const result = await service.findOrCreateByGoogle('new.user@gmail.com', 'g-9');

      expect(result).toMatchObject({
        id: 'user-g',
        email: 'new.user@gmail.com',
        googleId: 'g-9',
        isEmailVerified: true,
      });
      expect(result.passwordHash).toBeUndefined();
      expect(crypto.hash).not.toHaveBeenCalled();
      expect(publisher.publishUserCreatedEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          authUserId: 'user-g',
          email: 'new.user@gmail.com',
          handle: 'new.user',
        }),
      );
    });
  });
});
