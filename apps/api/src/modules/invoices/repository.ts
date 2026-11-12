import { and, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';

import type { Executor } from '../../db/client';
import {
  clients,
  invoiceItems,
  invoices,
  workspaces,
  type InvoiceItemRow,
  type InvoiceRow,
} from '../../db/schema';

export interface InvoiceListOptions {
  status?: string | undefined;
  clientId?: string | undefined;
  search?: string | undefined;
  limit: number;
  offset: number;
}

export interface InvoiceWithClient {
  invoice: InvoiceRow;
  clientName: string;
}

export interface WorkspaceDefaults {
  currency: string;
  invoicePrefix: string;
}

export interface NewInvoiceItem {
  description: string;
  quantityMilli: number;
  unitPriceMinor: bigint;
  taxRateBps: number;
  subtotalMinor: bigint;
  discountMinor: bigint;
  taxMinor: bigint;
  totalMinor: bigint;
}

function likePattern(search: string): string {
  return `%${search.replace(/[\\%_]/g, '\\$&')}%`;
}

function listFilter(workspaceId: string, options: InvoiceListOptions): SQL {
  const conditions: SQL[] = [eq(invoices.workspaceId, workspaceId)];

  if (options.status) {
    conditions.push(sql`${invoices.status} = ${options.status}`);
  }

  if (options.clientId) {
    conditions.push(eq(invoices.clientId, options.clientId));
  }

  if (options.search) {
    const pattern = likePattern(options.search);
    const match = or(ilike(invoices.number, pattern), ilike(clients.name, pattern));

    if (match) {
      conditions.push(match);
    }
  }

  return and(...conditions) as SQL;
}

export async function getWorkspaceDefaults(
  db: Executor,
  workspaceId: string,
): Promise<WorkspaceDefaults | null> {
  const rows = await db
    .select({ currency: workspaces.defaultCurrency, invoicePrefix: workspaces.invoicePrefix })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);

  return rows[0] ?? null;
}

/**
 * Reserves the next invoice number for the workspace.
 *
 * `next_invoice_number` is incremented in a single UPDATE, so two concurrent
 * creates serialize on the workspace row and cannot receive the same number.
 * Must be called inside the transaction that inserts the invoice.
 */
export async function allocateInvoiceNumber(db: Executor, workspaceId: string): Promise<string> {
  const rows = await db
    .update(workspaces)
    .set({ nextInvoiceNumber: sql`${workspaces.nextInvoiceNumber} + 1`, updatedAt: new Date() })
    .where(eq(workspaces.id, workspaceId))
    .returning({
      prefix: workspaces.invoicePrefix,
      allocated: sql<number>`${workspaces.nextInvoiceNumber} - 1`,
    });

  const row = rows[0];

  if (!row) {
    throw new Error('Workspace not found while allocating an invoice number.');
  }

  return `${row.prefix}-${String(row.allocated).padStart(4, '0')}`;
}

export async function insertInvoice(
  db: Executor,
  values: typeof invoices.$inferInsert,
): Promise<InvoiceRow> {
  const [row] = await db.insert(invoices).values(values).returning();

  if (!row) {
    throw new Error('Insert into invoices returned no row.');
  }

  return row;
}

export async function insertInvoiceItems(
  db: Executor,
  invoiceId: string,
  items: readonly NewInvoiceItem[],
): Promise<InvoiceItemRow[]> {
  return db
    .insert(invoiceItems)
    .values(
      items.map((item, position) => ({
        invoiceId,
        position,
        ...item,
      })),
    )
    .returning();
}

export async function deleteInvoiceItems(db: Executor, invoiceId: string): Promise<void> {
  await db.delete(invoiceItems).where(eq(invoiceItems.invoiceId, invoiceId));
}

export async function findInvoiceRow(
  db: Executor,
  workspaceId: string,
  invoiceId: string,
  lock = false,
): Promise<InvoiceWithClient | null> {
  const query = db
    .select({ invoice: invoices, clientName: clients.name })
    .from(invoices)
    .innerJoin(clients, eq(clients.id, invoices.clientId))
    .where(and(eq(invoices.workspaceId, workspaceId), eq(invoices.id, invoiceId)))
    .limit(1);

  const rows = lock ? await query.for('update') : await query;

  return rows[0] ?? null;
}

export async function findInvoiceItems(db: Executor, invoiceId: string): Promise<InvoiceItemRow[]> {
  return db
    .select()
    .from(invoiceItems)
    .where(eq(invoiceItems.invoiceId, invoiceId))
    .orderBy(invoiceItems.position);
}

export async function listInvoices(
  db: Executor,
  workspaceId: string,
  options: InvoiceListOptions,
): Promise<{ rows: InvoiceWithClient[]; total: number }> {
  const where = listFilter(workspaceId, options);

  const [rows, counts] = await Promise.all([
    db
      .select({ invoice: invoices, clientName: clients.name })
      .from(invoices)
      .innerJoin(clients, eq(clients.id, invoices.clientId))
      .where(where)
      .orderBy(desc(invoices.issueDate), desc(invoices.createdAt))
      .limit(options.limit)
      .offset(options.offset),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(invoices)
      .innerJoin(clients, eq(clients.id, invoices.clientId))
      .where(where),
  ]);

  return { rows, total: counts[0]?.total ?? 0 };
}

export async function updateInvoiceRow(
  db: Executor,
  workspaceId: string,
  invoiceId: string,
  patch: Partial<typeof invoices.$inferInsert>,
): Promise<InvoiceRow | null> {
  const [row] = await db
    .update(invoices)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(invoices.workspaceId, workspaceId), eq(invoices.id, invoiceId)))
    .returning();

  return row ?? null;
}

export async function deleteInvoiceRow(
  db: Executor,
  workspaceId: string,
  invoiceId: string,
): Promise<boolean> {
  const rows = await db
    .delete(invoices)
    .where(and(eq(invoices.workspaceId, workspaceId), eq(invoices.id, invoiceId)))
    .returning({ id: invoices.id });

  return rows.length > 0;
}
