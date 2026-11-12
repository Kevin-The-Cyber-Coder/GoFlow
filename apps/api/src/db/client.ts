import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import * as schema from './schema';

/**
 * The database handle used throughout the API.
 *
 * Typed as the node-postgres Drizzle database. Tests swap the underlying driver
 * for PGlite, which exposes the same `PgDatabase` surface (both return results
 * with a `rows` array), so the app code under test is identical to production.
 */
export type Database = NodePgDatabase<typeof schema>;

export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/** Anything that can run queries: the pool-backed database or a transaction. */
export type Executor = Database | Transaction;

export interface DatabaseConnection {
  db: Database;
  close: () => Promise<void>;
}

export function createDatabase(connectionString: string): DatabaseConnection {
  const pool = new Pool({
    connectionString,
    max: 10,
    // Fail fast instead of hanging a request when the database is unreachable.
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
  });

  const db = drizzle(pool, { schema }) as Database;

  return {
    db,
    close: async () => {
      await pool.end();
    },
  };
}

export { schema };
