import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthUser } from 'src/entities/auth-user.entity';
import { LoggerModule } from '@repo/shared';

@Module({
  imports: [
    TypeOrmModule.forFeature([AuthUser]),
    LoggerModule.forFeature('UsersService'),
  ], // Grants access to the AuthUser repository
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService], // Exported so authmodule can use it for login later
})
export class UsersModule {}
