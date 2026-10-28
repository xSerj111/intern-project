import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationPreferences } from './domain/entities/notification-preferences.entity';
import { PREFERENCES_REPOSITORY } from './domain/interfaces/preferences-repository.port';
import { PreferencesRepository } from './infrastructure/preferences.repository';
import { PreferencesController } from './preferences.controller';
import { PreferencesService } from './preferences.service';

@Module({
  imports: [TypeOrmModule.forFeature([NotificationPreferences])],
  controllers: [PreferencesController],
  providers: [
    PreferencesService,
    { provide: PREFERENCES_REPOSITORY, useClass: PreferencesRepository },
  ],
  exports: [PREFERENCES_REPOSITORY],
})
export class PreferencesModule {}
