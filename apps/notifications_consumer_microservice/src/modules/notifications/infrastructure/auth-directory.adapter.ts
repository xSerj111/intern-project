import { Inject, Injectable } from '@nestjs/common';
import { AppConfigService } from '../../../config/app-config.service';
import { RecipientContact } from '../domain/entities/recipient-contact.entity';
import {
  RECIPIENT_CONTACT_REPOSITORY,
  type IRecipientContactRepository,
} from '../domain/interfaces/recipient-contact-repository.port';
import type { IRecipientDirectory } from '../domain/interfaces/recipient-directory.port';

export const AUTH_LOOKUP_TIMEOUT_MS = 3000;

/**
 * Resolves recipient emails from auth's internal contact endpoint, caching
 * them in `recipient_contacts` for 24 h. Any failure other than 404 throws
 * (even when a stale row exists) so the email job goes through its retry path.
 */
@Injectable()
export class AuthDirectoryAdapter implements IRecipientDirectory {
  private readonly baseUrl: string;
  private readonly internalToken: string;

  constructor(
    config: AppConfigService,
    @Inject(RECIPIENT_CONTACT_REPOSITORY)
    private readonly contacts: IRecipientContactRepository,
  ) {
    // Read at construction so a missing/weak secret fails at startup, not on the first email.
    this.baseUrl = config.authInternalUrl.replace(/\/+$/, '');
    this.internalToken = config.internalApiToken;
  }

  async getEmail(userId: string): Promise<string | null> {
    const now = new Date();
    const cached = await this.contacts.findByUserId(userId);
    if (cached && !cached.isStale(now)) {
      return cached.email;
    }

    const email = await this.fetchEmail(userId);
    if (email === null) {
      return null;
    }

    const contact = cached ?? RecipientContact.create(userId, email, now);
    if (cached) {
      contact.refresh(email, now);
    }
    await this.contacts.save(contact);
    return email;
  }

  private async fetchEmail(userId: string): Promise<string | null> {
    const response = await fetch(
      `${this.baseUrl}/internal/users/${encodeURIComponent(userId)}/contact`,
      {
        headers: { 'X-Internal-Token': this.internalToken },
        signal: AbortSignal.timeout(AUTH_LOOKUP_TIMEOUT_MS),
      },
    );

    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new Error(
        `Auth contact lookup failed with status ${response.status}`,
      );
    }

    const body = (await response.json()) as { email?: unknown };
    if (typeof body.email !== 'string' || body.email.length === 0) {
      throw new Error('Auth contact lookup returned no email');
    }
    return body.email;
  }
}
