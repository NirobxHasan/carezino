/**
 * E2E tests truncate every table, so they only ever run against TEST_DATABASE_URL, a
 * database dedicated to tests. Apply migrations to it first:
 *   DATABASE_URL=$TEST_DATABASE_URL npx prisma migrate deploy
 */
const url = process.env.TEST_DATABASE_URL;
if (!url) {
  throw new Error(
    'Set TEST_DATABASE_URL to a disposable Postgres database to run the e2e tests. ' +
      'They delete all data in it.',
  );
}
// Set before Nest's ConfigModule loads .env; existing variables take precedence over it.
process.env.DATABASE_URL = url;
process.env.NODE_ENV = 'test';
process.env.PUBLIC_REGISTRATION_ENABLED = 'true';
process.env.WEB_APP_URL = 'http://web.test';
process.env.API_RATE_LIMIT_PER_MINUTE = '100000';
process.env.AUTH_RATE_LIMIT_PER_MINUTE = '100000';
// Per IP + email; the rate-limit test relies on this value.
process.env.AUTH_RATE_LIMIT_PER_ACCOUNT = '10';
delete process.env.SMTP_HOST;
