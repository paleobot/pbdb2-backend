import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SERVER = fileURLToPath(new URL('../src/server.js', import.meta.url));

// Dummy PG_* get past the database check, which runs first; the guard exits
// before build() or listen(), so nothing connects. An empty PUBLIC_BASE_URL
// counts as unset and keeps a value in the root `.env` from being loaded.
test('the server refuses to start outside development without PUBLIC_BASE_URL', () => {
  const result = spawnSync(process.execPath, [SERVER], {
    env: {
      PATH: process.env.PATH,
      NODE_ENV: 'production',
      PUBLIC_BASE_URL: '',
      PG_HOST: 'unused.invalid',
      PG_USER: 'unused',
      PG_PASSWORD: 'unused',
      PG_DATABASE: 'unused',
    },
    encoding: 'utf8',
    timeout: 10000,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /PUBLIC_BASE_URL is required when NODE_ENV is production/);
});
