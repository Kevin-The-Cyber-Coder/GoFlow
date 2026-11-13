import { Router, type Request } from 'express';

import { asyncHandler } from '../../http/async-handler';
import { authContext, requireAuth } from '../../middleware/auth';
import { requirePermission, resolveWorkspace, workspaceContext } from '../../middleware/workspace';
import {
  contactSchema,
  createClientSchema,
  listClientsSchema,
  updateClientSchema,
  updateContactSchema,
} from './schemas';
import {
  addContact,
  createClient,
  deleteClient,
  deleteContact,
  getClient,
  listClients,
  setClientArchived,
  updateClient,
  updateContact,
} from './service';

export const clientRouter: Router = Router();

function metaOf(req: Request): { ip: string | null; userAgent: string | null } {
  return { ip: req.ip ?? null, userAgent: req.header('user-agent') ?? null };
}

function param(req: Request, name: string): string {
  const value = req.params[name];
  return typeof value === 'string' ? value : '';
}

clientRouter.use(requireAuth, resolveWorkspace);

clientRouter.get(
  '/',
  requirePermission('clients:read'),
  asyncHandler(async (req, res) => {
    const { id } = workspaceContext(req);
    const query = listClientsSchema.parse(req.query);
    res.status(200).json(await listClients(id, query));
  }),
);

clientRouter.post(
  '/',
  requirePermission('clients:write'),
  asyncHandler(async (req, res) => {
    const { id, userId } = workspaceContext(req);
    const { email } = authContext(req);
    const input = createClientSchema.parse(req.body);
    const client = await createClient(id, userId, email, input, metaOf(req));
    res.status(201).json({ client });
  }),
);

clientRouter.get(
  '/:clientId',
  requirePermission('clients:read'),
  asyncHandler(async (req, res) => {
    const { id } = workspaceContext(req);
    res.status(200).json({ client: await getClient(id, param(req, 'clientId')) });
  }),
);

clientRouter.patch(
  '/:clientId',
  requirePermission('clients:write'),
  asyncHandler(async (req, res) => {
    const { id, userId } = workspaceContext(req);
    const { email } = authContext(req);
    const input = updateClientSchema.parse(req.body);
    const client = await updateClient(
      id,
      userId,
      email,
      param(req, 'clientId'),
      input,
      metaOf(req),
    );
    res.status(200).json({ client });
  }),
);

clientRouter.post(
  '/:clientId/archive',
  requirePermission('clients:write'),
  asyncHandler(async (req, res) => {
    const { id, userId } = workspaceContext(req);
    const { email } = authContext(req);
    const client = await setClientArchived(
      id,
      userId,
      email,
      param(req, 'clientId'),
      true,
      metaOf(req),
    );
    res.status(200).json({ client });
  }),
);

clientRouter.post(
  '/:clientId/restore',
  requirePermission('clients:write'),
  asyncHandler(async (req, res) => {
    const { id, userId } = workspaceContext(req);
    const { email } = authContext(req);
    const client = await setClientArchived(
      id,
      userId,
      email,
      param(req, 'clientId'),
      false,
      metaOf(req),
    );
    res.status(200).json({ client });
  }),
);

clientRouter.delete(
  '/:clientId',
  requirePermission('clients:delete'),
  asyncHandler(async (req, res) => {
    const { id, userId } = workspaceContext(req);
    const { email } = authContext(req);
    await deleteClient(id, userId, email, param(req, 'clientId'), metaOf(req));
    res.status(204).send();
  }),
);

clientRouter.get(
  '/:clientId/contacts',
  requirePermission('clients:read'),
  asyncHandler(async (req, res) => {
    const { id } = workspaceContext(req);
    const client = await getClient(id, param(req, 'clientId'));
    res.status(200).json({ contacts: client.contacts });
  }),
);

clientRouter.post(
  '/:clientId/contacts',
  requirePermission('clients:write'),
  asyncHandler(async (req, res) => {
    const { id, userId } = workspaceContext(req);
    const { email } = authContext(req);
    const input = contactSchema.parse(req.body);
    const contact = await addContact(id, userId, email, param(req, 'clientId'), input, metaOf(req));
    res.status(201).json({ contact });
  }),
);

clientRouter.patch(
  '/:clientId/contacts/:contactId',
  requirePermission('clients:write'),
  asyncHandler(async (req, res) => {
    const { id, userId } = workspaceContext(req);
    const { email } = authContext(req);
    const input = updateContactSchema.parse(req.body);
    const contact = await updateContact(
      id,
      userId,
      email,
      param(req, 'clientId'),
      param(req, 'contactId'),
      input,
      metaOf(req),
    );
    res.status(200).json({ contact });
  }),
);

clientRouter.delete(
  '/:clientId/contacts/:contactId',
  requirePermission('clients:write'),
  asyncHandler(async (req, res) => {
    const { id, userId } = workspaceContext(req);
    const { email } = authContext(req);
    await deleteContact(
      id,
      userId,
      email,
      param(req, 'clientId'),
      param(req, 'contactId'),
      metaOf(req),
    );
    res.status(204).send();
  }),
);
