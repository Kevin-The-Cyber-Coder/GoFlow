import type {
  Client,
  ClientListQuery,
  CreateClientInput,
  Page,
  UpdateClientInput,
} from '@goflow/shared';

import type { Database } from '../../db/client';
import type { ClientRow } from '../../db/schema';
import { notFound } from '../../lib/errors';
import {
  findClient,
  insertClient,
  listClients,
  setClientArchived,
  updateClient,
} from './repository';

/**
 * Converts a database row into the wire format. Timestamps become ISO strings
 * so the shared `Client` type is exactly what JSON.parse produces.
 */
export function toClient(row: ClientRow): Client {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    company: row.company,
    taxId: row.taxId,
    addressLine1: row.addressLine1,
    addressLine2: row.addressLine2,
    city: row.city,
    postalCode: row.postalCode,
    country: row.country,
    notes: row.notes,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export class ClientService {
  constructor(private readonly db: Database) {}

  async list(workspaceId: string, query: ClientListQuery): Promise<Page<Client>> {
    const { rows, total } = await listClients(this.db, workspaceId, {
      search: query.search,
      includeArchived: query.includeArchived,
      limit: query.limit,
      offset: query.offset,
    });

    return {
      items: rows.map(toClient),
      total,
      limit: query.limit,
      offset: query.offset,
    };
  }

  async get(workspaceId: string, clientId: string): Promise<Client> {
    const row = await findClient(this.db, workspaceId, clientId);

    if (!row) {
      throw notFound('Client not found.');
    }

    return toClient(row);
  }

  async create(workspaceId: string, input: CreateClientInput): Promise<Client> {
    const row = await insertClient(this.db, workspaceId, input);
    return toClient(row);
  }

  async update(workspaceId: string, clientId: string, patch: UpdateClientInput): Promise<Client> {
    const row = await updateClient(this.db, workspaceId, clientId, patch);

    if (!row) {
      throw notFound('Client not found.');
    }

    return toClient(row);
  }

  async archive(workspaceId: string, clientId: string): Promise<Client> {
    const row = await setClientArchived(this.db, workspaceId, clientId, true);

    if (!row) {
      throw notFound('Client not found.');
    }

    return toClient(row);
  }

  async restore(workspaceId: string, clientId: string): Promise<Client> {
    const row = await setClientArchived(this.db, workspaceId, clientId, false);

    if (!row) {
      throw notFound('Client not found.');
    }

    return toClient(row);
  }
}
