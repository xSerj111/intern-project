import type { NotificationPreferences } from '../entities/notification-preferences.entity';

export interface IPreferencesRepository {
  /** A missing row yields `NotificationPreferences.defaults(userId)` (not persisted). */
  findByUserId(userId: string): Promise<NotificationPreferences>;
  /** Insert or update by `userId`. */
  save(prefs: NotificationPreferences): Promise<NotificationPreferences>;
}

export const PREFERENCES_REPOSITORY = Symbol.for('IPreferencesRepository');
