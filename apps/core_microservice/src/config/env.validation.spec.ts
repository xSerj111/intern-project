import { validate } from './env.validation';

const valid = (): Record<string, unknown> => ({
  RABBITMQ_URL: 'amqp://guest:guest@localhost:5672',
  S3_ENDPOINT: 'localhost',
  S3_ACCESS_KEY: 'access',
  S3_SECRET_KEY: 'secret',
  S3_PRIVATE_BUCKET_NAME: 'private',
  JWT_SECRET: 'jwt-secret',
  INTERNAL_API_TOKEN: 'x'.repeat(32),
  POSTGRES_USER: 'innogram_user',
  POSTGRES_PASSWORD: 'db-password',
});

describe('env validation', () => {
  it('accepts the required variables alone', () => {
    const config = valid();
    expect(validate(config)).toBe(config);
  });

  it('accepts optional variables and treats empty values as unset', () => {
    expect(() =>
      validate({
        ...valid(),
        NODE_ENV: 'development',
        CORE_PORT: '3001',
        CLIENT_URL: '',
        REDIS_PASSWORD: '',
        S3_PUBLIC_ENDPOINT: '',
        S3_USE_SSL: 'false',
        PERF_INSTRUMENTATION: 'false',
        SWAGGER_ENABLED: '',
        UPLOAD_SWEEP_GRACE_SEC: '0',
      }),
    ).not.toThrow();
  });

  it('accepts true/false for SWAGGER_ENABLED and rejects anything else', () => {
    expect(() =>
      validate({ ...valid(), SWAGGER_ENABLED: 'true' }),
    ).not.toThrow();
    expect(() =>
      validate({ ...valid(), SWAGGER_ENABLED: 'false' }),
    ).not.toThrow();
    expect(() => validate({ ...valid(), SWAGGER_ENABLED: 'yes' })).toThrow(
      'SWAGGER_ENABLED',
    );
  });

  it.each([
    'RABBITMQ_URL',
    'S3_ENDPOINT',
    'S3_ACCESS_KEY',
    'S3_SECRET_KEY',
    'S3_PRIVATE_BUCKET_NAME',
    'JWT_SECRET',
    'INTERNAL_API_TOKEN',
    'POSTGRES_USER',
    'POSTGRES_PASSWORD',
  ])('names %s when it is missing', (key) => {
    const config = valid();
    delete config[key];
    expect(() => validate(config)).toThrow(key);
  });

  it('treats an empty required variable as missing', () => {
    expect(() => validate({ ...valid(), JWT_SECRET: '' })).toThrow(
      'JWT_SECRET',
    );
  });

  it('lists every failing variable in one error', () => {
    const config = valid();
    delete config.JWT_SECRET;
    delete config.RABBITMQ_URL;
    expect(() => validate(config)).toThrow(
      /JWT_SECRET[\s\S]*RABBITMQ_URL|RABBITMQ_URL[\s\S]*JWT_SECRET/,
    );
  });

  it.each(['0', '65536', 'abc', '30.5'])('rejects CORE_PORT=%s', (port) => {
    expect(() => validate({ ...valid(), CORE_PORT: port })).toThrow(
      'CORE_PORT',
    );
  });

  it('rejects out-of-range numbers and bad enums', () => {
    expect(() => validate({ ...valid(), SLOW_QUERY_MS: '0' })).toThrow(
      'SLOW_QUERY_MS',
    );
    expect(() => validate({ ...valid(), NODE_ENV: 'staging' })).toThrow(
      'NODE_ENV',
    );
    expect(() => validate({ ...valid(), S3_USE_SSL: 'yes' })).toThrow(
      'S3_USE_SSL',
    );
  });

  it('rejects a short INTERNAL_API_TOKEN without printing its value', () => {
    const token = 'short-token-value';
    let message = '';
    try {
      validate({ ...valid(), INTERNAL_API_TOKEN: token });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain('INTERNAL_API_TOKEN');
    expect(message).not.toContain(token);
  });

  it.each([
    'JWT_SECRET',
    'INTERNAL_API_TOKEN',
    'POSTGRES_PASSWORD',
    'REDIS_PASSWORD',
    'RABBITMQ_URL',
    'S3_ACCESS_KEY',
    'S3_SECRET_KEY',
  ])('rejects the CHANGE_ME placeholder for %s in production only', (key) => {
    const config = {
      ...valid(),
      REDIS_PASSWORD: 'redis-password',
      [key]: 'CHANGE_ME'.padEnd(40, '_'),
    };
    expect(() => validate({ ...config, NODE_ENV: 'production' })).toThrow(
      new RegExp(
        `${key}: must not be the \\.env\\.production\\.example placeholder`,
      ),
    );
    expect(() =>
      validate({ ...config, NODE_ENV: 'development' }),
    ).not.toThrow();
  });
  it('requires REDIS_PASSWORD in production only', () => {
    expect(() => validate({ ...valid(), NODE_ENV: 'production' })).toThrow(
      'REDIS_PASSWORD: is required in production',
    );
    expect(() =>
      validate({ ...valid(), NODE_ENV: 'production', REDIS_PASSWORD: '' }),
    ).toThrow('REDIS_PASSWORD: is required in production');
    expect(() =>
      validate({ ...valid(), NODE_ENV: 'development' }),
    ).not.toThrow();
  });
});
