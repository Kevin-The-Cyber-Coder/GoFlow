import {
  type CreatePaymentInput,
  type CreatePaymentResult,
  type InvoiceSummary,
  type Payment,
  type PaymentMethod,
} from '@goflow/shared';

import type { Database } from '../../db/client';
import type { PaymentRow } from '../../db/schema';
import { conflict, notFound } from '../../lib/errors';
import { findInvoiceRow, updateInvoiceRow } from '../invoices/repository';
import { toMinorNumber, toSummary } from '../invoices/service';
import { deletePayment, findPayment, insertPayment, listPayments, sumPayments } from './repository';

function toPayment(row: PaymentRow): Payment {
  return {
    id: row.id,
    invoiceId: row.invoiceId,
    amountMinor: toMinorNumber(row.amountMinor),
    currency: row.currency,
    method: row.method as PaymentMethod,
    reference: row.reference,
    paidAt: row.paidAt.toISOString(),
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
  };
}

export class PaymentService {
  constructor(private readonly db: Database) {}

  async list(workspaceId: string, invoiceId: string): Promise<Payment[]> {
    const found = await findInvoiceRow(this.db, workspaceId, invoiceId);

    if (!found) {
      throw notFound('Invoice not found.');
    }

    const rows = await listPayments(this.db, workspaceId, invoiceId);

    return rows.map(toPayment);
  }

  /**
   * Records a payment against a sent invoice.
   *
   * The invoice row is locked first, then the ledger is summed and the cached
   * `amount_paid_minor` is written. Two concurrent payments therefore serialise
   * on the invoice instead of both reading the same balance and overpaying it.
   */
  async create(
    workspaceId: string,
    invoiceId: string,
    input: CreatePaymentInput,
  ): Promise<CreatePaymentResult> {
    return this.db.transaction(async (tx) => {
      const found = await findInvoiceRow(tx, workspaceId, invoiceId, true);

      if (!found) {
        throw notFound('Invoice not found.');
      }

      const invoice = found.invoice;

      if (invoice.status !== 'sent') {
        throw conflict('Only sent invoices can receive payments.', 'INVOICE_NOT_PAYABLE');
      }

      const amount = BigInt(input.amountMinor);
      const balance = invoice.totalMinor - invoice.amountPaidMinor;

      if (amount > balance) {
        throw conflict('Payment exceeds the outstanding balance.', 'PAYMENT_EXCEEDS_BALANCE');
      }

      const payment = await insertPayment(tx, {
        workspaceId,
        invoiceId,
        amountMinor: amount,
        currency: invoice.currency,
        method: input.method,
        reference: input.reference,
        paidAt: input.paidAt ? new Date(input.paidAt) : new Date(),
        notes: input.notes,
      });

      const updated = await updateInvoiceRow(tx, workspaceId, invoiceId, {
        amountPaidMinor: invoice.amountPaidMinor + amount,
      });

      if (!updated) {
        throw notFound('Invoice not found.');
      }

      return { payment: toPayment(payment), invoice: toSummary(updated, found.clientName) };
    });
  }

  /**
   * Removes a mis-keyed payment and recomputes the cached total from the
   * remaining ledger, rather than subtracting from a value that may already be
   * wrong. Returns the updated invoice.
   */
  async remove(workspaceId: string, invoiceId: string, paymentId: string): Promise<InvoiceSummary> {
    return this.db.transaction(async (tx) => {
      const found = await findInvoiceRow(tx, workspaceId, invoiceId, true);

      if (!found) {
        throw notFound('Invoice not found.');
      }

      const existing = await findPayment(tx, workspaceId, invoiceId, paymentId);

      if (!existing) {
        throw notFound('Payment not found.');
      }

      await deletePayment(tx, workspaceId, invoiceId, paymentId);

      const paid = await sumPayments(tx, invoiceId);

      const updated = await updateInvoiceRow(tx, workspaceId, invoiceId, {
        amountPaidMinor: paid,
      });

      if (!updated) {
        throw notFound('Invoice not found.');
      }

      return toSummary(updated, found.clientName);
    });
  }
}
