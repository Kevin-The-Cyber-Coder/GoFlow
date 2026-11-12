import { and, asc, eq, sql } from 'drizzle-orm';

import type { Executor } from '../../db/client';
import { payments, type PaymentRow } from '../../db/schema';

export async function listPayments(
  db: Executor,
  workspaceId: string,
  invoiceId: string,
): Promise<PaymentRow[]> {
  return db
    .select()
    .from(payments)
    .where(and(eq(payments.workspaceId, workspaceId), eq(payments.invoiceId, invoiceId)))
    .orderBy(asc(payments.paidAt), asc(payments.createdAt));
}

export async function findPayment(
  db: Executor,
  workspaceId: string,
  invoiceId: string,
  paymentId: string,
): Promise<PaymentRow | null> {
  const rows = await db
    .select()
    .from(payments)
    .where(
      and(
        eq(payments.workspaceId, workspaceId),
        eq(payments.invoiceId, invoiceId),
        eq(payments.id, paymentId),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

export async function insertPayment(
  db: Executor,
  values: typeof payments.$inferInsert,
): Promise<PaymentRow> {
  const [row] = await db.insert(payments).values(values).returning();

  if (!row) {
    throw new Error('Insert into payments returned no row.');
  }

  return row;
}

export async function deletePayment(
  db: Executor,
  workspaceId: string,
  invoiceId: string,
  paymentId: string,
): Promise<boolean> {
  const rows = await db
    .delete(payments)
    .where(
      and(
        eq(payments.workspaceId, workspaceId),
        eq(payments.invoiceId, invoiceId),
        eq(payments.id, paymentId),
      ),
    )
    .returning({ id: payments.id });

  return rows.length > 0;
}

/**
 * Recomputes the cached paid amount from the ledger. Called only inside a
 * transaction that holds a `FOR UPDATE` lock on the invoice, so two payments
 * cannot interleave their read-compute-write cycle.
 */
export async function sumPayments(db: Executor, invoiceId: string): Promise<bigint> {
  const rows = await db
    .select({ total: sql<string>`coalesce(sum(${payments.amountMinor}), 0)::text` })
    .from(payments)
    .where(eq(payments.invoiceId, invoiceId));

  return BigInt(rows[0]?.total ?? '0');
}
