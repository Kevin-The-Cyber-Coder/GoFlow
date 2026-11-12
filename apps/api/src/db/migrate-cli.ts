import { loadConfig } from '../config/env';
import { createDatabase } from './client';
import { runMigrations } from './migrate';

/**
 * Applies pending migrations. Run explicitly (`npm run db:migrate`) rather than
 * on process start: several API instances booting at once would race, and a
 * failed migration should not prevent the service from starting in a known state.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const database = createDatabase(config.databaseUrl);

  try {
    const applied = await runMigrations(database.db, {
      logger: {
        info: (message) => console.log(message),
        error: (message, error) => console.error(message, error),
      },
    });

    console.log(
      applied.length === 0
        ? 'Database is up to date; no migrations were applied.'
        : `Applied ${applied.length} migration(s): ${applied.join(', ')}`,
    );
  } finally {
    await database.close();
  }
}

main().catch((error: unknown) => {
  console.error('Migration failed.', error);
  process.exitCode = 1;
});
