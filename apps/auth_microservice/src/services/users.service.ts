import type { DataSource } from 'typeorm';
import type { WinstonLogger } from '@repo/shared';
import { ICryptoService } from '../infrastructure/crypto/crypto.service';
// Załóżmy, że mamy encję i dto w shared:
import {
  CreateUserDto,
  UniqueConstraintViolationError,
  EntityNotFoundError,
} from '@repo/shared';
import { AuthUser } from '../domain/entities/auth-user.entity';
import { IAuthUserRepository } from '../domain/interfaces/auth-user-repository.interface';

export class UsersService {
  constructor(
    private readonly userRepository: IAuthUserRepository,
    private readonly logger: WinstonLogger,
    private readonly cryptoService: ICryptoService,
  ) {}

  async registerUser(
    dto: CreateUserDto,
  ): Promise<Omit<AuthUser, 'passwordHash'>> {
    const existing = await this.userRepository.findByEmail(dto.email);
    if (existing) {
      throw new UniqueConstraintViolationError(
        'User with this email already exists',
        dto.email,
      );
    }

    const passwordHash = await this.cryptoService.hash(dto.password, 10);

    const user = new AuthUser();
    user.email = dto.email;
    user.passwordHash = passwordHash;
    user.isEmailVerified = false;

    const savedUser = await this.userRepository.save(user);
    this.logger.debug('User registered', { props: { userId: savedUser.id } });

    const { passwordHash: _, ...safeUser } = savedUser;
    return safeUser;
  }

  async getUserById(id: string): Promise<Omit<AuthUser, 'passwordHash'>> {
    const user = await this.userRepository.findOneByIdOrThrow(id);

    const { passwordHash: _, ...safeUser } = user;
    return safeUser;
  }

  async findByEmailWithPassword(email: string): Promise<AuthUser | null> {
    return this.userRepository.findByEmail(email);
  }

  async findOrCreateByGoogle(
    email: string,
    googleId: string,
  ): Promise<AuthUser> {
    let user = await this.userRepository.findByEmail(email);

    if (user) {
      if (!user.googleId) {
        user.googleId = googleId;
        user.isEmailVerified = true;
        user = await this.userRepository.save(user);
        this.logger.debug('Linked Google account to existing user', {
          props: { userId: user.id },
        });
      }
      return user;
    }

    const newUser = new AuthUser();
    newUser.email = email;
    newUser.googleId = googleId;
    newUser.isEmailVerified = true;

    const savedUser = await this.userRepository.save(newUser);
    this.logger.debug('Create new user via Google login', {
      props: { userId: savedUser.id },
    });
    return savedUser;
  }
}
