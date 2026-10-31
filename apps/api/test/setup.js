import { assertTestDatabase, loadTestEnv } from './env.js';

loadTestEnv();
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ??= 'test-only-secret-0123456789abcdef0123456789';

if (process.env.TEST_DATABASE_URL) {
  assertTestDatabase(process.env.TEST_DATABASE_URL);
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}
