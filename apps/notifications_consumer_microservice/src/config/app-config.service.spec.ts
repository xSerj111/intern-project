import type { ConfigService } from '@nestjs/config';
import { AppConfigService } from './app-config.service';

describe('AppConfigService INTERNAL_API_TOKEN', () => {
  const build = (token: string | undefined) =>
    new AppConfigService({
      get: (key: string) => (key === 'INTERNAL_API_TOKEN' ? token : undefined),
    } as unknown as ConfigService);

  it('fails at bootstrap when the token is missing', () => {
    expect(() => build(undefined).onModuleInit()).toThrow(/INTERNAL_API_TOKEN/);
  });

  it('fails at bootstrap when the token is 31 characters', () => {
    expect(() => build('a'.repeat(31)).onModuleInit()).toThrow(
      /at least 32 characters/,
    );
  });

  it('accepts a 32-character token and exposes it', () => {
    const config = build('a'.repeat(32));
    expect(() => config.onModuleInit()).not.toThrow();
    expect(config.internalApiToken).toBe('a'.repeat(32));
  });
});
