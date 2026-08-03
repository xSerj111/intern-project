import { Module } from '@nestjs/common';
import { ProfilesModule } from '../profiles/profiles.module';
import { InternalEventsController } from './internal-events.controller';

@Module({
  imports: [ProfilesModule],
  controllers: [InternalEventsController],
})
export class InternalEventsModule {}
