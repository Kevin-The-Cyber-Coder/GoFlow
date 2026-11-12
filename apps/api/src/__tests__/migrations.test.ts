import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { sql } from 'drizzle-orm';

import { runMigrations, splitStatements } from '../db/migrate';
import { createTestContext, type TestContext } from './helpers/test-app';

describe('splitStatements', () => {
  it('splits on the drizzle breakpoint and drops empty chunks', () => {
    const statements = splitStatements(
      'CREATE TABLE a (id int);\n--> statement-breakpoint\n\nCREATE TABLE b (id int);',
    );

    expect(statements).toEqual(['CREATE TABLE a (id int);', 'CREATE TABLE b (id int);']);
  });
});

describe('migrations', () => {
  let context: TestContext;

  beforeAll(async () => {
    context = await createTestContext();
  }, 120_000);

  afterAll(async () => {
    await context.close();
  });

  it('are idempotent', async () => {
    // createTestContext already applied every migration.
    const applied = await runMigrations(context.db);

    expect(applied).toEqual([]);
  });

  it('create the expected tables', async () => {
    const result = await context.db.execute<{ table_name: string }>(
      sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
    );

    const tables = result.rows.map((row) => row.table_name);

    expect(tables).toEqual(
      expect.arrayContaining([
        '_migrations',
        'users',
        'workspaces',
        'workspace_members',
        'refresh_tokens',
      ]),
    );
  });
});
