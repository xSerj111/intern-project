import { Module } from '@nestjs/common';
import { InternalTokenGuard } from '../../common/observability/internal-token.guard';
import { ProfilesModule } from '../profiles/profiles.module';
import { InternalEventsController } from './internal-events.controller';

@Module({
  imports: [ProfilesModule],
  controllers: [InternalEventsController],
  // AppConfigService (the guard's dependency) comes from the global config module.
  providers: [InternalTokenGuard],
})
export class InternalEventsModule {}
