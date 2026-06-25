import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { AuthUser } from 'src/entities/auth-user.entity';
import { Repository } from 'typeorm';
import { CreateUserDto } from '@repo/shared';
import * as bcrypt from 'bcrypt';

@Injectable()
export class UsersService {
  constructor(
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

    return this.usersRepository.save(newUser);
  }

  async findById(id: string): Promise<AuthUser | null> {
    return this.usersRepository.findOne({ where: { id } });
  }

  async findByEmail(email: string): Promise<AuthUser | null> {
    return this.usersRepository.findOne({ where: { email } });
  }
}
