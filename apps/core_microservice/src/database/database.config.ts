/**
 * Postgres connection settings for the **TypeORM CLI** data source
 * (`data-source.ts`), which runs outside Nest DI and so cannot use
 * `AppConfigService`. The running app reads its config from `AppConfigService`
 * instead. Both resolve the same env vars (dotenv / ConfigModule load `.env`).
 * The credentials have no default, as in the app: a missing one throws.
 */
export function corePostgresConnection() {
  return {
    type: 'postgres' as const,
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
    username: requireCliEnv('POSTGRES_USER'),
    password: requireCliEnv('POSTGRES_PASSWORD'),
    database: process.env.DB_NAME_CORE || 'innogram_core',
    synchronize: false, // Strict migrations mode
  };
}

function requireCliEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
}
