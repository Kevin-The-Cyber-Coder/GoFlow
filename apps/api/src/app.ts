import cookieParser from 'cookie-parser';
import express, { type Express } from 'express';

import type { AppConfig } from './config/env';
import type { Database } from './db/client';
import { AppError } from './lib/errors';
import { TokenService } from './lib/tokens';
import { authenticate } from './middleware/authenticate';
import { errorHandler, notFoundHandler } from './middleware/error-handler';
import { requireWorkspace } from './middleware/workspace';
import { createAuthRouter } from './modules/auth/routes';
import { AuthService } from './modules/auth/service';
import { createClientsRouter } from './modules/clients/routes';
import { ClientService } from './modules/clients/service';
import { createInvoicesRouter } from './modules/invoices/routes';
import { InvoiceService } from './modules/invoices/service';
import { createUsersRouter } from './modules/users/routes';
import { healthRouter } from './routes/health';

export interface AppDependencies {
  db: Database;
  config: AppConfig;
}

/**
 * Builds the Express application without binding a port.
 *
 * Dependencies are injected rather than imported as singletons so integration
 * tests can run the real stack against an in-process database.
 */
export function createApp({ db, config }: AppDependencies): Express {
  const app = express();
  const tokens = new TokenService({
    secret: config.jwtSecret,
    accessTokenTtlSeconds: config.accessTokenTtlSeconds,
    refreshTokenTtlSeconds: config.refreshTokenTtlSeconds,
  });
  const authService = new AuthService({ db, tokens });
  const clientService = new ClientService(db);
  const invoiceService = new InvoiceService(db);

  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  app.use('/api/v1', healthRouter);
  app.use(
    '/api/v1/auth',
    createAuthRouter({
      service: authService,
      tokens,
      secureCookies: config.nodeEnv === 'production',
    }),
  );
  app.use('/api/v1/users', createUsersRouter({ authService, tokens }));
  app.use(
    '/api/v1/clients',
    authenticate(tokens),
    requireWorkspace(db),
    createClientsRouter({ service: clientService }),
  );
  app.use(
    '/api/v1/invoices',
    authenticate(tokens),
    requireWorkspace(db),
    createInvoicesRouter({ service: invoiceService }),
  );

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

export { AppError };
