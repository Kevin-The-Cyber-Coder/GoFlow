import { Router, type Request } from 'express';
import { clientListQuerySchema, createClientSchema, updateClientSchema } from '@goflow/shared';

import { badRequest } from '../../lib/errors';
import { isUuid } from '../../lib/ids';
import { parseQuery, validateBody } from '../../middleware/validate';
import { workspaceIdOf } from '../../middleware/workspace';
import type { ClientService } from './service';

function clientIdOf(req: Request): string {
  const id = req.params.id;

  if (!isUuid(id)) {
    throw badRequest('Client id must be a UUID.', 'INVALID_CLIENT_ID');
  }

  return id;
}

export interface ClientsRouterDependencies {
  service: ClientService;
}

export function createClientsRouter({ service }: ClientsRouterDependencies): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    const query = parseQuery(clientListQuerySchema, req);
    const page = await service.list(workspaceIdOf(req), query);

    res.status(200).json({ data: page });
  });

  router.post('/', validateBody(createClientSchema), async (req, res) => {
    const client = await service.create(workspaceIdOf(req), req.body);

    res.status(201).json({ data: client });
  });

  router.get('/:id', async (req, res) => {
    const client = await service.get(workspaceIdOf(req), clientIdOf(req));

    res.status(200).json({ data: client });
  });

  router.patch('/:id', validateBody(updateClientSchema), async (req, res) => {
    const client = await service.update(workspaceIdOf(req), clientIdOf(req), req.body);

    res.status(200).json({ data: client });
  });

  /**
   * Archiving rather than deleting keeps historic invoices attached to the
   * customer record. `POST /:id/restore` reverses it.
   */
  router.delete('/:id', async (req, res) => {
    await service.archive(workspaceIdOf(req), clientIdOf(req));

    res.status(204).send();
  });

  router.post('/:id/restore', async (req, res) => {
    const client = await service.restore(workspaceIdOf(req), clientIdOf(req));

    res.status(200).json({ data: client });
  });

  return router;
}
