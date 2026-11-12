import { and, eq, ilike, isNull, or, sql, type SQL } from 'drizzle-orm';

import type { Executor } from '../../db/client';
import { clients, type ClientRow } from '../../db/schema';
import type { CreateClientInput, UpdateClientInput } from '@goflow/shared';

export interface ListOptions {
  search?: string | undefined;
  includeArchived: boolean;
  limit: number;
  offset: number;
}

export interface ListResult {
  rows: ClientRow[];
  total: number;
}

/** Escapes LIKE wildcards so a search for "100%" does not match everything. */
function likePattern(search: string): string {
  return `%${search.replace(/[\\%_]/g, '\\$&')}%`;
}

function scopeFilter(workspaceId: string, options: ListOptions): SQL {
  const conditions: SQL[] = [eq(clients.workspaceId, workspaceId)];

  if (!options.includeArchived) {
    conditions.push(isNull(clients.archivedAt));
  }

  if (options.search) {
    const pattern = likePattern(options.search);
    const searchMatch = or(
      ilike(clients.name, pattern),
      ilike(clients.company, pattern),
      ilike(clients.email, pattern),
    );

    if (searchMatch) {
      conditions.push(searchMatch);
    }
  }

  return and(...conditions) as SQL;
}

export async function listClients(
  db: Executor,
  workspaceId: string,
  options: ListOptions,
): Promise<ListResult> {
  const where = scopeFilter(workspaceId, options);

  const [rows, counts] = await Promise.all([
    db
      .select()
      .from(clients)
      .where(where)
      .orderBy(sql`lower(${clients.name})`, clients.id)
      .limit(options.limit)
      .offset(options.offset),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(clients)
      .where(where),
  ]);

  return { rows, total: counts[0]?.total ?? 0 };
}

export async function findClient(
  db: Executor,
  workspaceId: string,
  clientId: string,
): Promise<ClientRow | null> {
  const rows = await db
    .select()
    .from(clients)
    .where(and(eq(clients.workspaceId, workspaceId), eq(clients.id, clientId)))
    .limit(1);

  return rows[0] ?? null;
}

export async function insertClient(
  db: Executor,
  workspaceId: string,
  input: CreateClientInput,
): Promise<ClientRow> {
  const [row] = await db
    .insert(clients)
    .values({ ...input, workspaceId })
    .returning();

  if (!row) {
    throw new Error('Insert into clients returned no row.');
  }

  return row;
}

export async function updateClient(
  db: Executor,
  workspaceId: string,
  clientId: string,
  patch: UpdateClientInput,
): Promise<ClientRow | null> {
  const [row] = await db
    .update(clients)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(clients.workspaceId, workspaceId), eq(clients.id, clientId)))
    .returning();

  return row ?? null;
}

export async function setClientArchived(
  db: Executor,
  workspaceId: string,
  clientId: string,
  archived: boolean,
): Promise<ClientRow | null> {
  const [row] = await db
    .update(clients)
    .set({ archivedAt: archived ? new Date() : null, updatedAt: new Date() })
    .where(and(eq(clients.workspaceId, workspaceId), eq(clients.id, clientId)))
    .returning();

  return row ?? null;
}
