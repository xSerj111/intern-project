import { Module } from '@nestjs/common';
import { ProfilesService } from './profiles.service';
import { ProfilesController } from './profiles.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserProfile } from 'src/entities/user-profile.entity';

@Module({
  imports: [TypeOrmModule.forFeature([UserProfile])],
  controllers: [ProfilesController],
  providers: [ProfilesService],
})
export class ProfilesModule {}
