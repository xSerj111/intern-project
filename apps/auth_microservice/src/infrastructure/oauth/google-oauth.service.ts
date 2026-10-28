import { OAuth2Client } from 'google-auth-library';
import { UnauthorizedError } from '@repo/shared';
import {
  IOAuthService,
  IOAuthPayload,
} from '../../domain/interfaces/oauth.service.interface';
import { googleConfig } from '../../config/google';

export class GoogleOAuthService implements IOAuthService {
  private readonly client: OAuth2Client;

  constructor() {
    this.client = new OAuth2Client(googleConfig.clientId);
  }

  async verifyIdToken(idToken: string): Promise<IOAuthPayload> {
    try {
      const ticket = await this.client.verifyIdToken({
        idToken,
        audience: googleConfig.clientId,
      });

      const payload = ticket.getPayload();

      if (!payload || !payload.email || !payload.sub) {
        throw new UnauthorizedError('Invalid Google token payload');
      }

      return {
        email: payload.email,
        sub: payload.sub,
      };
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        throw error;
      }
      throw new UnauthorizedError('Invalid Google token');
    }
  }
}
