import { createApp } from './app';
import { loadConfig } from './config/env';
import { createDatabase } from './db/client';

const config = loadConfig();
const database = createDatabase(config.databaseUrl);
const app = createApp({ db: database.db, config });

const server = app.listen(config.port, () => {
  console.log(`GoFlow API listening on http://localhost:${config.port} (${config.nodeEnv})`);
});

let shuttingDown = false;

function shutdown(signal: NodeJS.Signals): void {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  console.log(`Received ${signal}, shutting down.`);

  server.close((serverError) => {
    void database.close().finally(() => {
      if (serverError) {
        console.error('Error while closing the HTTP server.', serverError);
        process.exit(1);
      }

      process.exit(0);
    });
  });
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, shutdown);
}
