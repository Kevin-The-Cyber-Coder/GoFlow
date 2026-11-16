import express, { type Express } from 'express';

import { errorHandler, notFoundHandler } from './middleware/error-handler';
import {
  apiRateLimiter,
  authRateLimiter,
  corsMiddleware,
  securityHeaders,
} from './middleware/security';
import { auditRouter } from './modules/audit/routes';
import { authRouter } from './modules/auth/routes';
import { clientRouter } from './modules/clients/routes';
import { expenseRouter } from './modules/expenses/routes';
import { invoiceRouter } from './modules/invoices/routes';
import { paymentRouter } from './modules/payments/routes';
import { projectRouter } from './modules/projects/routes';
import { reportRouter } from './modules/reports/routes';
import { timeRouter } from './modules/time/routes';
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
  app.use(securityHeaders());
  app.use(corsMiddleware());
  app.use(express.json({ limit: '1mb' }));

  // Behind a proxy the client IP must come from the forwarded header, but
  // only when the deployment explicitly opts in (see TRUST_PROXY). This has to
  // happen before the rate limiters read `req.ip`.
  if (process.env.TRUST_PROXY === '1') {
    app.set('trust proxy', 1);
  }

  // Health is mounted before the limiters so a platform's liveness probe
  // cannot exhaust the API budget.
  app.use('/api/v1', healthRouter);
  app.use('/api/v1', apiRateLimiter());
  app.use('/api/v1/auth', authRateLimiter());
  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1/audit', auditRouter);
  app.use('/api/v1/workspaces', workspaceRouter);
  app.use('/api/v1/clients', clientRouter);
  app.use('/api/v1/expenses', expenseRouter);
  app.use('/api/v1/invoices', invoiceRouter);
  app.use('/api/v1/payments', paymentRouter);
  app.use('/api/v1/reports', reportRouter);
  app.use('/api/v1/projects', projectRouter);
  app.use('/api/v1/time', timeRouter);
  app.use('/api/v1/users', userRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
