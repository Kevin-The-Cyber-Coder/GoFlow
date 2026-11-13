import express, { type Express } from 'express';

import { errorHandler, notFoundHandler } from './middleware/error-handler';
import { authRouter } from './modules/auth/routes';
import { clientRouter } from './modules/clients/routes';
import { userRouter } from './modules/users/routes';
import { workspaceRouter } from './modules/workspaces/routes';
import { healthRouter } from './routes/health';

/**
 * Builds the Express application without binding a port.
 *
 * Keeping process concerns in `server.ts` lets integration tests exercise the
 * real middleware stack through supertest.
 */
export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));

  // Behind a proxy the client IP must come from the forwarded header, but
  // only when the deployment explicitly opts in (see TRUST_PROXY).
  if (process.env.TRUST_PROXY === '1') {
    app.set('trust proxy', 1);
  }

  app.use('/api/v1', healthRouter);
  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1/workspaces', workspaceRouter);
  app.use('/api/v1/clients', clientRouter);
  app.use('/api/v1/users', userRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
