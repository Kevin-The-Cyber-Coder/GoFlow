import { sql } from 'drizzle-orm';
import { bigint, check, index, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { invoices } from './invoices';
import { workspaces } from './workspaces';

export const paymentMethodEnum = pgEnum('payment_method', [
  'bank_transfer',
  'card',
  'cash',
  'paypal',
  'other',
]);

/**
 * Payments are append-only ledger entries. `invoices.amount_paid_minor` is a
 * cached sum that is recomputed in the same transaction as any insert or
 * delete, so the invoice row and the ledger never disagree.
 *
 * `workspace_id` is denormalised deliberately: it lets every query be scoped by
 * workspace without joining the invoice table.
 */
export const payments = pgTable(
  'payments',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'cascade' }),
    amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
    currency: text('currency').notNull(),
    method: paymentMethodEnum('method').notNull().default('bank_transfer'),
    reference: text('reference'),
    paidAt: timestamp('paid_at', { withTimezone: true }).notNull().defaultNow(),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('payments_workspace_invoice_idx').on(table.workspaceId, table.invoiceId),
    index('payments_invoice_paid_at_idx').on(table.invoiceId, table.paidAt),
    check('payments_amount_positive', sql`${table.amountMinor} > 0`),
  ],
);

export type PaymentRow = typeof payments.$inferSelect;
