import { defineConfig } from 'drizzle-kit';

/**
 * Used by `npm run db:generate` to produce SQL migrations from the schema.
 * Migrations are reviewed and committed; `drizzle-kit push` is never used
 * against shared environments (see ADR-002).
 */
export default defineConfig({
  schema: './src/db/schema/index.ts',
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgresql://goflow:goflow@localhost:5432/goflow',
  },
  strict: true,
  verbose: true,
});
