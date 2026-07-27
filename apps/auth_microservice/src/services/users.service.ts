import type { DataSource } from 'typeorm';
import type { WinstonLogger } from '@repo/shared';
// Załóżmy, że mamy encję i dto w shared:
import {
  CreateUserDto,
  UniqueConstraintViolationError,
  EntityNotFoundError,
} from '@repo/shared';
import { AuthUser } from 'src/entities/auth-user.entity';
import * as bcrypt from 'bcrypt';

export class UsersService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly logger: WinstonLogger,
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

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const user = repo.create({
      email: dto.email,
      handle: dto.handle,
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
}
