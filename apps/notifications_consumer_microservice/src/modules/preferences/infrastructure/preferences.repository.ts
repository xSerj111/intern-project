import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { NotificationPreferences } from '../domain/entities/notification-preferences.entity';
import type { IPreferencesRepository } from '../domain/interfaces/preferences-repository.port';

@Injectable()
export class PreferencesRepository implements IPreferencesRepository {
  constructor(
    @InjectRepository(NotificationPreferences)
    private readonly repository: Repository<NotificationPreferences>,
  ) {}

  /** A missing row yields the all-on defaults without persisting them. */
  async findByUserId(userId: string): Promise<NotificationPreferences> {
    const row = await this.repository.findOne({ where: { userId } });
    return row ?? NotificationPreferences.defaults(userId);
  }

  /** Primary-key `save`: inserts the first row for a user, updates later ones. */
  save(prefs: NotificationPreferences): Promise<NotificationPreferences> {
    return this.repository.save(prefs);
  }
}
