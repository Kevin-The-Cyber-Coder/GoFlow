import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { sql } from 'drizzle-orm';
import type { Express } from 'express';

import type { AppConfig } from '../../config/env';
import type { Database } from '../../db/client';
import { runMigrations } from '../../db/migrate';
import * as schema from '../../db/schema';
import { createApp } from '../../app';

export interface TestContext {
  app: Express;
  db: Database;
  config: AppConfig;
  close: () => Promise<void>;
}

const TEST_SECRET = 'test-only-jwt-secret-that-is-long-enough';

/**
 * Runs the real API against an in-process Postgres (PGlite).
 *
 * PGlite is Postgres compiled to WASM: the migration SQL, constraints, indexes
 * and transactions under test are the same ones production runs, unlike an
 * in-memory stub.
 */
export async function createTestContext(): Promise<TestContext> {
  const client = new PGlite();
  await client.waitReady;

  const db = drizzle(client, { schema }) as unknown as Database;

  await runMigrations(db);

  const config: AppConfig = {
    nodeEnv: 'test',
    port: 0,
    databaseUrl: 'pglite://memory',
    jwtSecret: TEST_SECRET,
    accessTokenTtlSeconds: 900,
    refreshTokenTtlSeconds: 3_600,
  };

  return {
    app: createApp({ db, config }),
    db,
    config,
    close: async () => {
      await client.close();
    },
  };
}

/**
 * Empties every application table between tests while keeping the schema and
 * migration history. Cheaper than booting a new PGlite instance per test.
 */
export async function resetDatabase(db: Database): Promise<void> {
  await db.execute(
    sql`TRUNCATE TABLE "refresh_tokens", "workspace_members", "workspaces", "users" RESTART IDENTITY CASCADE`,
  );
}

/** Pulls a single cookie value out of a `set-cookie` header. */
export function readCookie(
  setCookie: string | string[] | undefined,
  name: string,
): string | undefined {
  const headers = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  const match = headers.find((header) => header.startsWith(`${name}=`));

  return match?.split(';')[0]?.split('=')[1];
}
