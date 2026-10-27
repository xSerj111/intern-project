type Env = typeof import('./env').env;

const REQUIRED = {
  CORE_SERVICE_URL: 'http://core.test:3001',
  AUTH_ALLOWED_ORIGINS: 'http://localhost:3000',
  INTERNAL_API_TOKEN: 'a'.repeat(40),
};

const PROD_SECRETS = {
  JWT_SECRET: 'p'.repeat(40),
  JWT_REFRESH_SECRET: 'r'.repeat(40),
};

const MANAGED_KEYS = [
  ...Object.keys(REQUIRED),
  'AUTH_PORT',
  'AUTH_INTERNAL_PORT',
  'AUTH_INTERNAL_HOST',
  'POSTGRES_HOST',
  'POSTGRES_PORT',
  'POSTGRES_USER',
  'POSTGRES_PASSWORD',
  'DB_NAME_AUTH',
  'REDIS_HOST',
  'REDIS_PORT',
  'REDIS_PASSWORD',
  'JWT_SECRET',
  'JWT_REFRESH_SECRET',
  'JWT_EXPIRES_IN',
  'JWT_REFRESH_EXPIRES_IN',
  'GOOGLE_CLIENT_ID',
  'BCRYPT_SALT_ROUNDS',
  'NODE_ENV',
  'AUTH_COOKIE_SAMESITE',
];

describe('config/env', () => {
  const saved = { ...process.env };

  const loadEnv = (overrides: Record<string, string | undefined> = {}): Env => {
    for (const key of MANAGED_KEYS) delete process.env[key];
    Object.assign(process.env, REQUIRED);
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    let loaded!: Env;
    jest.isolateModules(() => {
      // Keep the real root .env from refilling variables the test removed.
      jest.doMock('dotenv', () => ({ config: jest.fn() }));
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      loaded = (require('./env') as { env: Env }).env;
    });
    return loaded;
  };

  afterEach(() => {
    jest.dontMock('dotenv');
    for (const key of Object.keys(process.env)) {
      if (!(key in saved)) delete process.env[key];
    }
    Object.assign(process.env, saved);
  });

  describe('fail-fast', () => {
    it.each(Object.keys(REQUIRED))('throws when %s is missing', (key) => {
      expect(() => loadEnv({ [key]: undefined })).toThrow(
        `Missing required enviroment variable: ${key}`,
      );
    });

    it('rejects an INTERNAL_API_TOKEN shorter than 32 characters', () => {
      expect(() => loadEnv({ INTERNAL_API_TOKEN: 'short' })).toThrow(
        'INTERNAL_API_TOKEN must be at least 32 characters long',
      );
    });

    it('accepts an INTERNAL_API_TOKEN of exactly 32 characters', () => {
      expect(loadEnv({ INTERNAL_API_TOKEN: 'x'.repeat(32) }).app.internalApiToken).toBe(
        'x'.repeat(32),
      );
    });

    it('rejects an unknown AUTH_COOKIE_SAMESITE', () => {
      expect(() => loadEnv({ AUTH_COOKIE_SAMESITE: 'bogus' })).toThrow(
        'AUTH_COOKIE_SAMESITE must be one of: strict, lax, none',
      );
    });
  });

  describe('defaults', () => {
    it('fills in defaults for optional variables', () => {
      const env = loadEnv();

      expect(env.app).toMatchObject({
        port: 3002,
        internalPort: 3012,
        internalHost: '127.0.0.1',
        coreMicroserviceUrl: REQUIRED.CORE_SERVICE_URL,
        allowedOrigins: REQUIRED.AUTH_ALLOWED_ORIGINS,
      });
      expect(env.db).toEqual({
        host: 'localhost',
        port: 5432,
        username: 'innogram_user',
        password: 'innogram_password',
        database: 'innogram_auth',
      });
      expect(env.redis).toEqual({ host: 'localhost', port: 6379, password: undefined });
      expect(env.jwt.accessTokenExpiry).toBe('15m');
      expect(env.jwt.refreshTokenExpiry).toBe('7d');
      expect(env.crypto.saltRounds).toBe(10);
      expect(env.cookie).toEqual({ secure: false, sameSite: 'strict' });
    });
  });

  describe('overrides', () => {
    it('reads values from the environment', () => {
      const env = loadEnv({
        AUTH_PORT: '4000',
        AUTH_INTERNAL_PORT: '4012',
        AUTH_INTERNAL_HOST: '0.0.0.0',
        POSTGRES_HOST: 'db',
        POSTGRES_PORT: '5433',
        DB_NAME_AUTH: 'custom',
        REDIS_HOST: 'cache',
        REDIS_PORT: '6380',
        REDIS_PASSWORD: 'pw',
        JWT_SECRET: 's1',
        JWT_REFRESH_SECRET: 's2',
        JWT_EXPIRES_IN: '5m',
        JWT_REFRESH_EXPIRES_IN: '1d',
        GOOGLE_CLIENT_ID: 'gid',
        BCRYPT_SALT_ROUNDS: '12',
      });

      expect(env.app).toMatchObject({
        port: 4000,
        internalPort: 4012,
        internalHost: '0.0.0.0',
      });
      expect(env.db).toMatchObject({ host: 'db', port: 5433, database: 'custom' });
      expect(env.redis).toEqual({ host: 'cache', port: 6380, password: 'pw' });
      expect(env.jwt).toEqual({
        accessTokenSecret: 's1',
        refreshTokenSecret: 's2',
        accessTokenExpiry: '5m',
        refreshTokenExpiry: '1d',
      });
      expect(env.google.clientId).toBe('gid');
      expect(env.crypto.saltRounds).toBe(12);
    });

    it.each(['strict', 'lax', 'none'] as const)('accepts sameSite %s', (value) => {
      expect(loadEnv({ AUTH_COOKIE_SAMESITE: value }).cookie.sameSite).toBe(value);
    });

    it('marks the cookie secure in production', () => {
      expect(loadEnv({ NODE_ENV: 'production', ...PROD_SECRETS }).cookie.secure).toBe(
        true,
      );
    });
  });

  describe('production JWT secret guard', () => {
    const PLACEHOLDERS = {
      JWT_SECRET: 'your-super-secret-jwt-key-here',
      JWT_REFRESH_SECRET: 'your-super-secret-jwt-refresh-key-here',
    };

    it('accepts strong secrets', () => {
      const env = loadEnv({ NODE_ENV: 'production', ...PROD_SECRETS });
      expect(env.jwt.accessTokenSecret).toBe(PROD_SECRETS.JWT_SECRET);
      expect(env.jwt.refreshTokenSecret).toBe(PROD_SECRETS.JWT_REFRESH_SECRET);
    });

    it.each(['JWT_SECRET', 'JWT_REFRESH_SECRET'] as const)(
      'requires %s with no fallback',
      (key) => {
        expect(() =>
          loadEnv({ NODE_ENV: 'production', ...PROD_SECRETS, [key]: undefined }),
        ).toThrow(`Missing required enviroment variable: ${key}`);
      },
    );

    it.each(['JWT_SECRET', 'JWT_REFRESH_SECRET'] as const)(
      'rejects a %s shorter than 32 characters without leaking it',
      (key) => {
        const short = 'q'.repeat(31);
        let message = '';
        try {
          loadEnv({ NODE_ENV: 'production', ...PROD_SECRETS, [key]: short });
        } catch (e) {
          message = (e as Error).message;
        }
        expect(message).toContain(`${key} must be at least 32 characters long`);
        expect(message).not.toContain(short);
      },
    );

    it('accepts a secret of exactly 32 characters', () => {
      expect(
        loadEnv({ NODE_ENV: 'production', ...PROD_SECRETS, JWT_SECRET: 'x'.repeat(32) })
          .jwt.accessTokenSecret,
      ).toBe('x'.repeat(32));
    });

    it.each(['JWT_SECRET', 'JWT_REFRESH_SECRET'] as const)(
      'rejects the .env.example placeholder for %s without leaking it',
      (key) => {
        let message = '';
        try {
          loadEnv({ NODE_ENV: 'production', ...PROD_SECRETS, [key]: PLACEHOLDERS[key] });
        } catch (e) {
          message = (e as Error).message;
        }
        expect(message).toContain(`${key} must not be the .env.example placeholder`);
        expect(message).not.toContain(PLACEHOLDERS[key]);
      },
    );

    it('keeps the dev defaults outside production', () => {
      const env = loadEnv({ NODE_ENV: 'development' });
      expect(env.jwt.accessTokenSecret).toBe(PLACEHOLDERS.JWT_SECRET);
      expect(env.jwt.refreshTokenSecret).toBe(PLACEHOLDERS.JWT_REFRESH_SECRET);
    });

    it('does not apply the length rule outside production', () => {
      expect(loadEnv({ JWT_SECRET: 'short' }).jwt.accessTokenSecret).toBe('short');
    });
  });
});
