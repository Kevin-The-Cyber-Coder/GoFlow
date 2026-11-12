import { sql } from 'drizzle-orm';
import { char, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { workspaces } from './workspaces';

/**
 * A client is a customer the workspace invoices. Rows are never deleted so that
 * historic invoices keep a resolvable reference; `archivedAt` hides them from
 * the default list instead.
 */
export const clients = pgTable(
  'clients',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    email: text('email'),
    phone: text('phone'),
    company: text('company'),
    taxId: text('tax_id'),
    addressLine1: text('address_line1'),
    addressLine2: text('address_line2'),
    city: text('city'),
    postalCode: text('postal_code'),
    country: char('country', { length: 2 }),
    notes: text('notes'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('clients_workspace_id_idx').on(table.workspaceId),
    // Supports the default list (name order) and case-insensitive search.
    index('clients_workspace_name_idx').on(table.workspaceId, sql`lower(${table.name})`),
  ],
);

export type ClientRow = typeof clients.$inferSelect;
export type NewClientRow = typeof clients.$inferInsert;
