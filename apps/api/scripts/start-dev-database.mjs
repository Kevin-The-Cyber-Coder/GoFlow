/**
 * Starts a persistent PostgreSQL server for local development.
 *
 * The integration suite starts an embedded server for the duration of a test
 * run; the dev server needs one that survives between commands. This script
 * uses the same binary and keeps the data directory outside the repository, so
 * `npm run db:dev` works on a machine without Docker and the cluster, its data
 * and the seeded demo workspace are still there on the next start.
 *
 * Stop it with Ctrl+C. The cluster is shut down with the script, and because
 * the directory is persistent it is initialised only once.
 */
import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

import EmbeddedPostgres from 'embedded-postgres';

const port = Number(process.env.DEV_DATABASE_PORT ?? 55432);
const dataDir = process.env.DEV_DATABASE_DIR ?? path.join(homedir(), '.goflow', 'postgres');
const user = 'goflow';
const password = 'goflow';
const database = 'goflow';

if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
  console.error(
    `DEV_DATABASE_PORT must be a valid port, received "${process.env.DEV_DATABASE_PORT}".`,
  );
  process.exit(1);
}

mkdirSync(dataDir, { recursive: true });

const server = new EmbeddedPostgres({
  databaseDir: dataDir,
  user,
  password,
  port,
  persistent: true,
});

// `initialise()` populates an empty directory and refuses one that already
// holds a cluster, so the presence of PG_VERSION is the reset-safe test.
if (!existsSync(path.join(dataDir, 'PG_VERSION'))) {
  console.log(`[db:dev] initialising a new cluster in ${dataDir}`);
  await server.initialise();
}

await server.start();

try {
  await server.createDatabase(database);
  console.log(`[db:dev] created database "${database}"`);
} catch {
  // Already created on a previous run; that is the normal case, not a failure.
}

console.log(
  [
    `[db:dev] PostgreSQL listening on 127.0.0.1:${port} (data in ${dataDir})`,
    `[db:dev] DATABASE_URL=postgresql://${user}:${password}@127.0.0.1:${port}/${database}`,
    '[db:dev] apply the schema with `npm run db:deploy`, then `npm run db:seed`',
    '[db:dev] press Ctrl+C to stop',
  ].join('\n'),
);

let stopping = false;
async function stop(signal) {
  if (stopping) {
    return;
  }
  stopping = true;
  console.log(`[db:dev] received ${signal}, stopping PostgreSQL`);
  try {
    await server.stop();
  } catch (error) {
    console.warn(`[db:dev] shutdown reported: ${String(error)}`);
  }
  process.exit(0);
}

process.on('SIGINT', () => void stop('SIGINT'));
process.on('SIGTERM', () => void stop('SIGTERM'));

// Nothing else to do; keeping the event loop alive is the point of the script.
process.stdin.resume();
