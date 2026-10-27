import { validate } from './env.validation';

const valid = (): Record<string, unknown> => ({
  RABBITMQ_URL: 'amqp://user:s3cr3t-pw@localhost:5672',
  JWT_SECRET: 'jwt-secret-value',
  INTERNAL_API_TOKEN: 'x'.repeat(40),
  AUTH_INTERNAL_URL: 'http://localhost:3012',
  CLIENT_URL: 'http://localhost:3000',
  SMTP_HOST: 'localhost',
  SMTP_PORT: '1025',
  SMTP_SECURE: 'false',
  SMTP_FROM: 'Innogram <no-reply@innogram.local>',
});

describe('notifications env validation', () => {
  it('passes with only the required variables and keeps unrelated keys', () => {
    const result = validate({ ...valid(), SOMETHING_ELSE: 'kept' });
    expect(result.SMTP_PORT).toBe(1025);
    expect(result).toHaveProperty('SOMETHING_ELSE', 'kept');
  });

  it('accepts optional variables with valid values', () => {
    expect(() =>
      validate({
        ...valid(),
        NODE_ENV: 'production',
        NOTIFICATIONS_PORT: '3003',
        POSTGRES_PORT: '5432',
        REDIS_PORT: '6379',
        SMTP_USER: '',
        SMTP_PASS: '',
      }),
    ).not.toThrow();
  });

  it.each([
    'RABBITMQ_URL',
    'JWT_SECRET',
    'INTERNAL_API_TOKEN',
    'AUTH_INTERNAL_URL',
    'CLIENT_URL',
    'SMTP_HOST',
    'SMTP_PORT',
    'SMTP_SECURE',
    'SMTP_FROM',
  ])('names the missing required variable %s', (key) => {
    const env = valid();
    delete env[key];
    expect(() => validate(env)).toThrow(new RegExp(key));
  });

  it('lists every failing variable in one error', () => {
    try {
      validate({});
      fail('expected validate to throw');
    } catch (e) {
      const message = (e as Error).message;
      expect(message).toContain('RABBITMQ_URL');
      expect(message).toContain('SMTP_HOST');
      expect(message).toContain('CLIENT_URL');
    }
  });

  it.each(['0', '65536', 'abc', '10.5'])('rejects SMTP_PORT=%s', (port) => {
    expect(() => validate({ ...valid(), SMTP_PORT: port })).toThrow(
      /SMTP_PORT/,
    );
  });

  it('rejects an out-of-range optional port', () => {
    expect(() => validate({ ...valid(), NOTIFICATIONS_PORT: '70000' })).toThrow(
      /NOTIFICATIONS_PORT/,
    );
  });

  it('rejects an invalid NODE_ENV and SMTP_SECURE', () => {
    expect(() => validate({ ...valid(), NODE_ENV: 'staging' })).toThrow(
      /NODE_ENV/,
    );
    expect(() => validate({ ...valid(), SMTP_SECURE: 'yes' })).toThrow(
      /SMTP_SECURE/,
    );
  });

  it('rejects an INTERNAL_API_TOKEN shorter than 32 characters', () => {
    expect(() =>
      validate({ ...valid(), INTERNAL_API_TOKEN: 'y'.repeat(31) }),
    ).toThrow(/INTERNAL_API_TOKEN/);
  });

  it('never prints a value in the error message', () => {
    const env = {
      ...valid(),
      INTERNAL_API_TOKEN: 'short-secret-token',
      SMTP_PORT: 'not-a-port-value',
      CLIENT_URL: 'not a url with-secret',
    };
    try {
      validate(env);
      fail('expected validate to throw');
    } catch (e) {
      const message = (e as Error).message;
      expect(message).not.toContain('short-secret-token');
      expect(message).not.toContain('not-a-port-value');
      expect(message).not.toContain('with-secret');
      expect(message).not.toContain('s3cr3t-pw');
    }
  });

  it.each(['JWT_SECRET', 'INTERNAL_API_TOKEN'])(
    'rejects the CHANGE_ME placeholder for %s in production only',
    (key) => {
      const config = { ...valid(), [key]: 'CHANGE_ME'.padEnd(40, '_') };
      expect(() => validate({ ...config, NODE_ENV: 'production' })).toThrow(
        new RegExp(
          `${key}: must not be the \\.env\\.production\\.example placeholder`,
        ),
      );
      expect(() =>
        validate({ ...config, NODE_ENV: 'development' }),
      ).not.toThrow();
    },
  );
});
