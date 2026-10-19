import { Global, Module } from '@nestjs/common';
import {
  ACCESS_TOKEN_VERIFIER,
  accessTokenVerifierProvider,
} from './access-token-verifier.provider';

/**
 * Global because `JwtAuthGuard` is applied via `@UseGuards` in feature
 * modules and each one must resolve the verifier.
 */
@Global()
@Module({
  providers: [accessTokenVerifierProvider],
  exports: [ACCESS_TOKEN_VERIFIER],
})
export class CommonAuthModule {}
