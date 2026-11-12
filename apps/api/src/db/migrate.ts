import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { sql } from 'drizzle-orm';

import type { Database } from './client';

const BREAKPOINT = '--> statement-breakpoint';

export interface MigrationLogger {
  info: (message: string) => void;
  error: (message: string, error?: unknown) => void;
}

export const MIGRATIONS_DIRECTORY = path.join(__dirname, 'migrations');

/**
 * Splits a migration file into statements.
 *
 * Drizzle's generator writes explicit breakpoints. We need them because the
 * extended query protocol used by node-postgres rejects multi-statement strings.
 */
export function splitStatements(migrationSql: string): string[] {
  return migrationSql
    .split(BREAKPOINT)
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

async function ensureMigrationsTable(db: Database): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "_migrations" (
      "name" text PRIMARY KEY NOT NULL,
      "applied_at" timestamp with time zone NOT NULL DEFAULT now()
    )
  `);
}

async function appliedMigrations(db: Database): Promise<Set<string>> {
  const result = await db.execute<{ name: string }>(sql`SELECT "name" FROM "_migrations"`);
  return new Set(result.rows.map((row) => row.name));
}

export interface RunMigrationsOptions {
  directory?: string;
  logger?: MigrationLogger;
}

/**
 * Applies every migration that has not been recorded yet, in filename order.
 *
 * Each migration runs inside its own transaction so a failure leaves the
 * database at the last successfully applied version rather than half-migrated.
 */
export async function runMigrations(
  db: Database,
  options: RunMigrationsOptions = {},
): Promise<string[]> {
  const directory = options.directory ?? MIGRATIONS_DIRECTORY;
  const logger = options.logger;

  await ensureMigrationsTable(db);
  const alreadyApplied = await appliedMigrations(db);

  const files = (await readdir(directory))
    .filter((file) => file.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b));

  const applied: string[] = [];

  for (const file of files) {
    if (alreadyApplied.has(file)) {
      continue;
    }

    const contents = await readFile(path.join(directory, file), 'utf8');
    const statements = splitStatements(contents);

    try {
      await db.transaction(async (tx) => {
        for (const statement of statements) {
          await tx.execute(sql.raw(statement));
        }

        await tx.execute(sql`INSERT INTO "_migrations" ("name") VALUES (${file})`);
      });
    } catch (error) {
      logger?.error(`Migration ${file} failed.`, error);
      throw error;
    }

    logger?.info(`Applied migration ${file}.`);
    applied.push(file);
  }

  return applied;
}
