/**
 * Runs the API integration suite against a real PostgreSQL instance.
 *
 * In CI a Postgres service container is provided through DATABASE_URL, so the
 * embedded server is skipped. On a developer machine without Docker, an
 * embedded PostgreSQL binary is started on a random port, migrations are
 * applied, and the server is torn down afterwards. Either way the tests see a
 * genuine PostgreSQL server — no in-memory SQL emulation.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import EmbeddedPostgres from 'embedded-postgres';

const externalUrl = process.env.DATABASE_URL;
let embedded;
let dataDir;
let databaseUrl = externalUrl;

if (externalUrl === undefined || externalUrl.length === 0) {
  const port = 54_000 + Math.floor(Math.random() * 2_000);
  dataDir = mkdtempSync(path.join(tmpdir(), 'goflow-pg-'));
  databaseUrl = `postgresql://goflow:goflow@127.0.0.1:${port}/goflow_test`;

  embedded = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'goflow',
    password: 'goflow',
    port,
    persistent: false,
  });

  await embedded.initialise();
  await embedded.start();
  await embedded.createDatabase('goflow_test');
  console.log(`[integration] embedded PostgreSQL listening on port ${port}`);
}

function run(command) {
  const result = spawnSync(command, {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'inherit',
    shell: true,
  });
  return result.status ?? 1;
}

let exitCode = run('npx prisma migrate deploy');
if (exitCode === 0) {
  exitCode = run('npx jest --config jest.integration.config.cjs --runInBand');
}

if (embedded !== undefined) {
  await embedded.stop();
}
if (dataDir !== undefined) {
  // On Windows the postmaster can still hold handles for a moment after
  // shutdown; a failed cleanup must never mask the test result.
  try {
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
  } catch (error) {
    console.warn(`[integration] could not remove temporary data directory: ${String(error)}`);
  }
}

process.exit(exitCode);
