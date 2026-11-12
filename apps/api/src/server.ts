import { createApp } from './app';
import { loadConfig } from './config/env';

const config = loadConfig();
const app = createApp();

const server = app.listen(config.port, () => {
  console.log(`GoFlow API listening on http://localhost:${config.port} (${config.nodeEnv})`);
});

function shutdown(signal: NodeJS.Signals): void {
  console.log(`Received ${signal}, shutting down.`);
  server.close((error) => {
    if (error) {
      console.error('Error while closing the HTTP server.', error);
      process.exit(1);
    }

    process.exit(0);
  });
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, shutdown);
}
