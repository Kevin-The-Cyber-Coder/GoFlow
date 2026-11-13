import { getPrisma } from '../database/client';

const IGNORED_TABLES = new Set(['_prisma_migrations']);

/**
 * Empties every application table between tests.
 *
 * `TRUNCATE ... CASCADE` is used instead of per-model deletes because the
 * schema's foreign-key graph is large; truncating in one statement avoids
 * ordering bugs and runs fast on an empty test database.
 */
export async function resetDatabase(): Promise<void> {
  const prisma = getPrisma();
  const rows = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  `;

  const tables = rows
    .map((row) => row.tablename)
    .filter((name) => !IGNORED_TABLES.has(name))
    .map((name) => `"public"."${name}"`);

  if (tables.length === 0) {
    return;
  }

  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.join(', ')} RESTART IDENTITY CASCADE`);
}
