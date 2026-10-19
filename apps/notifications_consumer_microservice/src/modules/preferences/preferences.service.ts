import { Inject, Injectable } from '@nestjs/common';
import {
  PREFERENCES_REPOSITORY,
  type IPreferencesRepository,
} from './domain/interfaces/preferences-repository.port';
import { PreferencesResponseDto } from './dto/preferences-response.dto';
import type { UpdatePreferencesDto } from './dto/update-preferences.dto';

@Injectable()
export class PreferencesService {
  constructor(
    @Inject(PREFERENCES_REPOSITORY)
    private readonly preferences: IPreferencesRepository,
  ) {}

  /** All switches on when the user has no row yet. */
  async get(userId: string): Promise<PreferencesResponseDto> {
    return new PreferencesResponseDto(
      await this.preferences.findByUserId(userId),
    );
  }

  /** Upserts the caller's row; applies to notifications created after the save. */
  async update(
    userId: string,
    dto: UpdatePreferencesDto,
  ): Promise<PreferencesResponseDto> {
    const prefs = await this.preferences.findByUserId(userId);
    prefs.update(dto);
    return new PreferencesResponseDto(await this.preferences.save(prefs));
  }
}
