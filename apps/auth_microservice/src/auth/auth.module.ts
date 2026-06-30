import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { LoggerModule } from '@repo/shared';

@Module({
  imports:[
    LoggerModule.forFeature('AuthService'),
  ],
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}
