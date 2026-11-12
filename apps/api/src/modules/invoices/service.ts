import {
  calculateInvoice,
  formatQuantityMilli,
  parseQuantityToMilli,
  type CreateInvoiceInput,
  type Invoice,
  type InvoiceDiscountInput,
  type InvoiceItem,
  type InvoiceItemInput,
  type InvoiceListQuery,
  type InvoiceStatus,
  type InvoiceSummary,
  type Page,
  type PaymentStatus,
  type UpdateInvoiceInput,
} from '@goflow/shared';

import type { Database } from '../../db/client';
import type { InvoiceItemRow, InvoiceRow } from '../../db/schema';
import { AppError, badRequest, conflict, notFound } from '../../lib/errors';
import { findClient } from '../clients/repository';
import {
  allocateInvoiceNumber,
  deleteInvoiceItems,
  deleteInvoiceRow,
  findInvoiceItems,
  findInvoiceRow,
  getWorkspaceDefaults,
  insertInvoice,
  insertInvoiceItems,
  listInvoices,
  updateInvoiceRow,
  type NewInvoiceItem,
} from './repository';

const MAX_SAFE_MINOR = BigInt(Number.MAX_SAFE_INTEGER);

/**
 * Money is stored as bigint but JSON has no bigint. Every realistic amount fits
 * in a double exactly; anything larger is a bug we refuse to serialise silently.
 */
export function toMinorNumber(value: bigint): number {
  if (value > MAX_SAFE_MINOR || value < -MAX_SAFE_MINOR) {
    throw new AppError(
      500,
      'AMOUNT_OUT_OF_RANGE',
      'An invoice amount exceeds the supported range.',
    );
  }

  return Number(value);
}

interface LineInput {
  description: string;
  quantityMilli: number;
  unitPriceMinor: bigint;
  taxRateBps: number;
}

function discountToRow(discount: InvoiceDiscountInput): {
  discountType: 'none' | 'fixed' | 'percent';
  discountValue: bigint;
} {
  switch (discount.type) {
    case 'none':
      return { discountType: 'none', discountValue: 0n };
    case 'fixed':
      return { discountType: 'fixed', discountValue: BigInt(discount.amountMinor) };
    case 'percent':
      return { discountType: 'percent', discountValue: BigInt(discount.rateBps) };
  }
}

function discountFromRow(row: InvoiceRow): InvoiceDiscountInput {
  switch (row.discountType) {
    case 'fixed':
      return { type: 'fixed', amountMinor: toMinorNumber(row.discountValue) };
    case 'percent':
      return { type: 'percent', rateBps: toMinorNumber(row.discountValue) };
    default:
      return { type: 'none' };
  }
}

/** Structural typing lets the pure calculator stay independent of the database. */
function calculatorDiscount(discount: InvoiceDiscountInput) {
  switch (discount.type) {
    case 'none':
      return { type: 'none' as const };
    case 'fixed':
      return { type: 'fixed' as const, amountMinor: BigInt(discount.amountMinor) };
    case 'percent':
      return { type: 'percent' as const, rateBps: discount.rateBps };
  }
}

function lineFromRow(row: InvoiceItemRow): LineInput {
  return {
    description: row.description,
    quantityMilli: row.quantityMilli,
    unitPriceMinor: row.unitPriceMinor,
    taxRateBps: row.taxRateBps,
  };
}

function isOverdue(row: InvoiceRow, now: Date): boolean {
  if (row.status !== 'sent') {
    return false;
  }

  return new Date(`${row.dueDate}T23:59:59.999Z`).getTime() < now.getTime();
}

function paymentStatusOf(row: InvoiceRow, now = new Date()): PaymentStatus {
  if (row.amountPaidMinor >= row.totalMinor) {
    return 'paid';
  }

  if (row.status === 'draft' || row.status === 'cancelled' || row.status === 'void') {
    return row.amountPaidMinor > 0n ? 'partial' : 'unpaid';
  }

  if (isOverdue(row, now)) {
    return 'overdue';
  }

  return row.amountPaidMinor > 0n ? 'partial' : 'unpaid';
}

function toItemDto(row: InvoiceItemRow): InvoiceItem {
  return {
    id: row.id,
    description: row.description,
    quantity: formatQuantityMilli(row.quantityMilli),
    unitPriceMinor: toMinorNumber(row.unitPriceMinor),
    taxRateBps: row.taxRateBps,
    subtotalMinor: toMinorNumber(row.subtotalMinor),
    discountMinor: toMinorNumber(row.discountMinor),
    taxMinor: toMinorNumber(row.taxMinor),
    totalMinor: toMinorNumber(row.totalMinor),
  };
}

export function toSummary(row: InvoiceRow, clientName: string): InvoiceSummary {
  return {
    id: row.id,
    number: row.number,
    status: row.status as InvoiceStatus,
    paymentStatus: paymentStatusOf(row),
    clientId: row.clientId,
    clientName,
    currency: row.currency,
    issueDate: row.issueDate,
    dueDate: row.dueDate,
    subtotalMinor: toMinorNumber(row.subtotalMinor),
    discountMinor: toMinorNumber(row.discountMinor),
    taxMinor: toMinorNumber(row.taxMinor),
    totalMinor: toMinorNumber(row.totalMinor),
    amountPaidMinor: toMinorNumber(row.amountPaidMinor),
    balanceMinor: toMinorNumber(row.totalMinor - row.amountPaidMinor),
    sentAt: row.sentAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toInvoice(row: InvoiceRow, clientName: string, items: InvoiceItemRow[]): Invoice {
  return {
    ...toSummary(row, clientName),
    notes: row.notes,
    terms: row.terms,
    discount: discountFromRow(row),
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    voidedAt: row.voidedAt?.toISOString() ?? null,
    items: items.map(toItemDto),
  };
}

export class InvoiceService {
  constructor(private readonly db: Database) {}

  private calculate(
    lines: readonly LineInput[],
    discount: InvoiceDiscountInput,
  ): { totals: ReturnType<typeof calculateInvoice>; items: NewInvoiceItem[] } {
    const totals = calculateInvoice(lines, calculatorDiscount(discount));

    const items = lines.map((line, index) => {
      const calculated = totals.lines[index];

      if (!calculated) {
        throw new Error('Calculator returned fewer lines than it received.');
      }

      return {
        description: line.description,
        quantityMilli: line.quantityMilli,
        unitPriceMinor: line.unitPriceMinor,
        taxRateBps: line.taxRateBps,
        subtotalMinor: calculated.subtotalMinor,
        discountMinor: calculated.discountMinor,
        taxMinor: calculated.taxMinor,
        totalMinor: calculated.totalMinor,
      };
    });

    return { totals, items };
  }

  private bodyLines(items: readonly InvoiceItemInput[]): LineInput[] {
    return items.map((item) => ({
      description: item.description,
      quantityMilli: parseQuantityToMilli(item.quantity),
      unitPriceMinor: BigInt(item.unitPriceMinor),
      taxRateBps: item.taxRateBps,
    }));
  }

  private async load(workspaceId: string, invoiceId: string): Promise<Invoice> {
    const found = await findInvoiceRow(this.db, workspaceId, invoiceId);

    if (!found) {
      throw notFound('Invoice not found.');
    }

    const items = await findInvoiceItems(this.db, found.invoice.id);

    return toInvoice(found.invoice, found.clientName, items);
  }

  async list(workspaceId: string, query: InvoiceListQuery): Promise<Page<InvoiceSummary>> {
    const { rows, total } = await listInvoices(this.db, workspaceId, {
      status: query.status,
      clientId: query.clientId,
      search: query.search,
      limit: query.limit,
      offset: query.offset,
    });

    return {
      items: rows.map((row) => toSummary(row.invoice, row.clientName)),
      total,
      limit: query.limit,
      offset: query.offset,
    };
  }

  get(workspaceId: string, invoiceId: string): Promise<Invoice> {
    return this.load(workspaceId, invoiceId);
  }

  async create(workspaceId: string, input: CreateInvoiceInput): Promise<Invoice> {
    return this.db.transaction(async (tx) => {
      const client = await findClient(tx, workspaceId, input.clientId);

      if (!client) {
        throw notFound('Client not found.');
      }

      const defaults = await getWorkspaceDefaults(tx, workspaceId);

      if (!defaults) {
        throw new Error('Workspace not found while creating an invoice.');
      }

      const currency = input.currency ?? defaults.currency;
      const { totals, items } = this.calculate(this.bodyLines(input.items), input.discount);
      const number = await allocateInvoiceNumber(tx, workspaceId);

      const row = await insertInvoice(tx, {
        workspaceId,
        clientId: client.id,
        number,
        status: 'draft',
        currency,
        issueDate: input.issueDate,
        dueDate: input.dueDate,
        notes: input.notes,
        terms: input.terms,
        ...discountToRow(input.discount),
        subtotalMinor: totals.subtotalMinor,
        discountMinor: totals.discountMinor,
        taxMinor: totals.taxMinor,
        totalMinor: totals.totalMinor,
        amountPaidMinor: 0n,
      });

      const storedItems = await insertInvoiceItems(tx, row.id, items);

      return toInvoice(row, client.name, storedItems);
    });
  }

  async update(
    workspaceId: string,
    invoiceId: string,
    input: UpdateInvoiceInput,
  ): Promise<Invoice> {
    return this.db.transaction(async (tx) => {
      const found = await findInvoiceRow(tx, workspaceId, invoiceId, true);

      if (!found) {
        throw notFound('Invoice not found.');
      }

      const row = found.invoice;

      if (row.status !== 'draft') {
        throw conflict('Only draft invoices can be edited.', 'INVOICE_NOT_EDITABLE');
      }

      let clientName = found.clientName;

      if (input.clientId && input.clientId !== row.clientId) {
        const client = await findClient(tx, workspaceId, input.clientId);

        if (!client) {
          throw notFound('Client not found.');
        }

        clientName = client.name;
      }

      const issueDate = input.issueDate ?? row.issueDate;
      const dueDate = input.dueDate ?? row.dueDate;

      if (dueDate < issueDate) {
        throw badRequest('Due date must not be before the issue date.', 'INVALID_DUE_DATE');
      }

      const discount = input.discount ?? discountFromRow(row);
      const lines =
        input.items !== undefined
          ? this.bodyLines(input.items)
          : (await findInvoiceItems(tx, row.id)).map(lineFromRow);

      const { totals, items } = this.calculate(lines, discount);

      await deleteInvoiceItems(tx, row.id);
      const storedItems = await insertInvoiceItems(tx, row.id, items);

      const updated = await updateInvoiceRow(tx, workspaceId, row.id, {
        clientId: input.clientId ?? row.clientId,
        currency: input.currency ?? row.currency,
        issueDate,
        dueDate,
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        ...(input.terms !== undefined ? { terms: input.terms } : {}),
        ...discountToRow(discount),
        subtotalMinor: totals.subtotalMinor,
        discountMinor: totals.discountMinor,
        taxMinor: totals.taxMinor,
        totalMinor: totals.totalMinor,
      });

      if (!updated) {
        throw notFound('Invoice not found.');
      }

      return toInvoice(updated, clientName, storedItems);
    });
  }

  async send(workspaceId: string, invoiceId: string): Promise<Invoice> {
    return this.transition(
      workspaceId,
      invoiceId,
      ['draft'],
      {
        status: 'sent',
        sentAt: new Date(),
      },
      'Only draft invoices can be sent.',
    );
  }

  async cancel(workspaceId: string, invoiceId: string): Promise<Invoice> {
    return this.transition(
      workspaceId,
      invoiceId,
      ['draft'],
      {
        status: 'cancelled',
        cancelledAt: new Date(),
      },
      'Only draft invoices can be cancelled.',
    );
  }

  async void(workspaceId: string, invoiceId: string): Promise<Invoice> {
    return this.transition(
      workspaceId,
      invoiceId,
      ['sent'],
      {
        status: 'void',
        voidedAt: new Date(),
      },
      'Only sent invoices can be voided.',
    );
  }

  private async transition(
    workspaceId: string,
    invoiceId: string,
    from: readonly InvoiceStatus[],
    patch: Partial<{
      status: InvoiceStatus;
      sentAt: Date | null;
      cancelledAt: Date | null;
      voidedAt: Date | null;
    }>,
    message: string,
  ): Promise<Invoice> {
    const found = await findInvoiceRow(this.db, workspaceId, invoiceId);

    if (!found) {
      throw notFound('Invoice not found.');
    }

    if (!from.includes(found.invoice.status as InvoiceStatus)) {
      throw conflict(message, 'INVALID_STATUS_TRANSITION');
    }

    const updated = await updateInvoiceRow(this.db, workspaceId, invoiceId, patch);

    if (!updated) {
      throw notFound('Invoice not found.');
    }

    return this.load(workspaceId, invoiceId);
  }

  async remove(workspaceId: string, invoiceId: string): Promise<void> {
    const found = await findInvoiceRow(this.db, workspaceId, invoiceId);

    if (!found) {
      throw notFound('Invoice not found.');
    }

    if (found.invoice.status !== 'draft') {
      throw conflict('Only draft invoices can be deleted.', 'INVOICE_NOT_DELETABLE');
    }

    await deleteInvoiceRow(this.db, workspaceId, invoiceId);
  }
}
