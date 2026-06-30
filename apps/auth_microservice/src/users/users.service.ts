import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { AuthUser } from 'src/entities/auth-user.entity';
import { Repository } from 'typeorm';
import { CreateUserDto, LoggerKey, type Logger } from '@repo/shared';
import * as bcrypt from 'bcrypt';

@Injectable()
export class UsersService {
  constructor(
    @Inject(LoggerKey) private readonly logger: Logger,
    @InjectRepository(AuthUser)
    private readonly usersRepository: Repository<AuthUser>,
  ) {}

  async createUser(createUserDto: CreateUserDto): Promise<AuthUser> {
    const { email, password } = createUserDto;

    // Check if user already exists
    const existingUser = await this.usersRepository.findOne({
      where: { email },
    });
    if (existingUser) {
      throw new ConflictException('Email is already registered');
    }

    // Hash the password
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // Create and save entity
    const newUser = this.usersRepository.create({
      email,
      passwordHash,
    });

    const savedUser = await this.usersRepository.save(newUser);
    this.logger.debug('User created', { props: { email: savedUser.email } });
    return savedUser;
  }

  async findById(id: string): Promise<AuthUser | null> {
    const user = await this.usersRepository.findOne({ where: { id } });
    if (user) {
      this.logger.debug('User found by id', { props: { email: user.email } });
    }
    return user;
  }

  async findByEmail(email: string): Promise<AuthUser | null> {
    const user = await this.usersRepository.findOne({ where: { email } });
    if (user) {
      this.logger.debug('User found by email', { props: { email: user.email } });
    }
    return user;
  }
}
