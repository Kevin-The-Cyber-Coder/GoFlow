import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { clients } from './clients';
import { workspaces } from './workspaces';

export const invoiceStatusEnum = pgEnum('invoice_status', ['draft', 'sent', 'cancelled', 'void']);

export const invoiceDiscountTypeEnum = pgEnum('invoice_discount_type', [
  'none',
  'fixed',
  'percent',
]);

/**
 * Totals are persisted (not only derived) because lists and reports read them
 * constantly. They are always recomputed inside the same transaction that
 * changes the lines, so they cannot drift from the items.
 */
export const invoices = pgTable(
  'invoices',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'restrict' }),
    number: text('number').notNull(),
    status: invoiceStatusEnum('status').notNull().default('draft'),
    currency: text('currency').notNull(),
    issueDate: date('issue_date', { mode: 'string' }).notNull(),
    dueDate: date('due_date', { mode: 'string' }).notNull(),
    notes: text('notes'),
    terms: text('terms'),
    discountType: invoiceDiscountTypeEnum('discount_type').notNull().default('none'),
    /** Basis points for `percent`, minor units for `fixed`, 0 for `none`. */
    discountValue: bigint('discount_value', { mode: 'bigint' }).notNull(),
    subtotalMinor: bigint('subtotal_minor', { mode: 'bigint' }).notNull(),
    discountMinor: bigint('discount_minor', { mode: 'bigint' }).notNull(),
    taxMinor: bigint('tax_minor', { mode: 'bigint' }).notNull(),
    totalMinor: bigint('total_minor', { mode: 'bigint' }).notNull(),
    amountPaidMinor: bigint('amount_paid_minor', { mode: 'bigint' }).notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('invoices_workspace_number_unique').on(table.workspaceId, table.number),
    index('invoices_workspace_status_idx').on(table.workspaceId, table.status),
    index('invoices_workspace_client_idx').on(table.workspaceId, table.clientId),
    index('invoices_workspace_issue_date_idx').on(table.workspaceId, table.issueDate),
    check('invoices_total_non_negative', sql`${table.totalMinor} >= 0`),
  ],
);

export const invoiceItems = pgTable(
  'invoice_items',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    description: text('description').notNull(),
    /** Quantity in milli-units: 1500 = 1.5. */
    quantityMilli: integer('quantity_milli').notNull(),
    unitPriceMinor: bigint('unit_price_minor', { mode: 'bigint' }).notNull(),
    taxRateBps: integer('tax_rate_bps').notNull().default(0),
    subtotalMinor: bigint('subtotal_minor', { mode: 'bigint' }).notNull(),
    discountMinor: bigint('discount_minor', { mode: 'bigint' }).notNull(),
    taxMinor: bigint('tax_minor', { mode: 'bigint' }).notNull(),
    totalMinor: bigint('total_minor', { mode: 'bigint' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('invoice_items_invoice_position_unique').on(table.invoiceId, table.position),
    index('invoice_items_invoice_id_idx').on(table.invoiceId),
    check('invoice_items_quantity_positive', sql`${table.quantityMilli} > 0`),
    check('invoice_items_price_non_negative', sql`${table.unitPriceMinor} >= 0`),
    check('invoice_items_tax_rate_range', sql`${table.taxRateBps} between 0 and 10000`),
  ],
);

export type InvoiceRow = typeof invoices.$inferSelect;
export type InvoiceItemRow = typeof invoiceItems.$inferSelect;
