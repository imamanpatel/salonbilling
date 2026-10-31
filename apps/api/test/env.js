import { fileURLToPath } from 'node:url';

/** Loads apps/api/.env.test if present (never .env, so tests can't touch the dev database). */
export function loadTestEnv() {
  try {
    process.loadEnvFile(fileURLToPath(new URL('../.env.test', import.meta.url)));
  } catch {
    // .env.test is optional; DB tests are skipped without TEST_DATABASE_URL.
  }
}

/** Integration tests wipe tables, so only allow databases explicitly named *_test. */
export function assertTestDatabase(url) {
  const name = new URL(url).pathname.slice(1);
  if (!name.endsWith('_test')) {
    throw new Error(`Refusing to run tests against "${name}": TEST_DATABASE_URL must name a database ending in _test`);
  }
}
