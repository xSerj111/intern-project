import type { DataSource } from 'typeorm';
import type { WinstonLogger } from '@repo/shared';
import { ICryptoService } from './crypto.service';
// Załóżmy, że mamy encję i dto w shared:
import {
  CreateUserDto,
  UniqueConstraintViolationError,
  EntityNotFoundError,
} from '@repo/shared';
import { AuthUser } from '../entities/auth-user.entity';


export class UsersService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly logger: WinstonLogger,
    private readonly cryptoService: ICryptoService,
  ) {}

  async registerUser(
    dto: CreateUserDto,
  ): Promise<Omit<AuthUser, 'passwordHash'>> {
    const repo = this.dataSource.getRepository(AuthUser);

    // Sprawdzamy czy istnieje
    const existing = await repo.findOne({ where: { email: dto.email } });
    if (existing) {
      throw new UniqueConstraintViolationError(
        'User with this email already exists',
        dto.email,
      );
    }

    const passwordHash = await this.cryptoService.hash(dto.password, 10);
    const user = repo.create({
      email: dto.email,
      passwordHash,
    });

    const savedUser = await repo.save(user);
    this.logger.debug('User registered', { props: { userId: savedUser.id } });

    const { passwordHash: _, ...safeUser } = savedUser;
    return safeUser;
  }

  async getUserById(id: string): Promise<Omit<AuthUser, 'passwordHash'>> {
    const repo = this.dataSource.getRepository(AuthUser);
    const user = await repo.findOne({ where: { id } });

    if (!user) {
      throw new EntityNotFoundError('AuthUser', id);
    }

    const { passwordHash: _, ...safeUser } = user;
    return safeUser;
  }

  async findByEmailWithPassword(email: string): Promise<AuthUser | null> {
    const repo = this.dataSource.getRepository(AuthUser);
    return repo.findOne({ where: { email } });
  }

  async findOrCreateByGoogle(
    email: string,
    googleId: string,
  ): Promise<AuthUser> {
    const repo = this.dataSource.getRepository(AuthUser);
    let user = await repo.findOne({ where: { email } });

    if (user) {
      if (!user.googleId) {
        user.googleId = googleId;
        user.isEmailVerified = true;
        user = await repo.save(user);
        this.logger.debug('Linked Google account to existing user', {
          props: { userId: user.id },
        });
      }
      return user;
    }

    const newUser = repo.create({
      email,
      googleId,
      isEmailVerified: true,
    });

    const savedUser = await repo.save(newUser);
    this.logger.debug('Create new user via Google login', {
      props: { userId: savedUser.id },
    });
    return savedUser;
  }
}
