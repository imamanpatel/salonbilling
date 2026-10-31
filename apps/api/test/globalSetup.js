import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assertTestDatabase, loadTestEnv } from './env.js';

/** Applies migrations to the test database once per run. */
export default function setup() {
  loadTestEnv();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return;
  assertTestDatabase(url);
  execSync('npx prisma migrate deploy', {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'inherit',
  });
}
