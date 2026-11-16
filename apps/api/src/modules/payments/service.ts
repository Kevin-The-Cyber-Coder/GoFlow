import type { Payment, Prisma } from '@prisma/client';

import { getPrisma } from '../../database/client';
import { ApiError } from '../../http/errors';
import { money, pageMeta, toPagination } from '../../http/pagination';
import { auditData } from '../audit/service';
import type { RequestMeta } from '../clients/service';
import type { CreatePaymentInput, ListPaymentsQuery, ReversePaymentInput } from './schemas';

/** Only an issued invoice can receive money. A draft has not been agreed yet. */
const PAYABLE_STATUSES: readonly string[] = ['SENT', 'PARTIALLY_PAID'];

function utcDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function todayIso(): string {
  return isoDate(new Date());
}

function paymentDto(payment: Payment) {
  return {
    id: payment.id,
    invoiceId: payment.invoiceId,
    kind: payment.kind,
    status: payment.status,
    amountMinor: money(payment.amountMinor),
    currency: payment.currency,
    method: payment.method,
    paidAt: isoDate(payment.paidAt),
    reference: payment.reference,
    notes: payment.notes,
    recordedById: payment.recordedById,
    refundOfPaymentId: payment.refundOfPaymentId,
    reversedAt: payment.reversedAt,
    createdAt: payment.createdAt,
  };
}

type LockedInvoice = {
  id: string;
  number: string;
  status: string;
  currency: string;
  totalMinor: bigint;
};

/**
 * Takes a row-level lock on the invoice before any money is written.
 *
 * Two requests paying the same invoice concurrently must not both read the
 * same outstanding balance and then both pass the "does this fit" check, so
 * the row is locked for the rest of the transaction. The lock is taken through
 * a workspace-scoped query, which is also what makes a foreign invoice id a
 * `404` rather than a leak of its existence.
 */
async function lockInvoice(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  invoiceId: string,
): Promise<LockedInvoice> {
  const locked = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "Invoice"
    WHERE "id" = ${invoiceId} AND "workspaceId" = ${workspaceId}
    FOR UPDATE
  `;
  if (locked.length === 0) {
    throw ApiError.notFound('Invoice');
  }

  const invoice = await tx.invoice.findUniqueOrThrow({
    where: { id: invoiceId },
    select: {
      id: true,
      number: true,
      status: true,
      currency: true,
      totalMinor: true,
    },
  });

  return invoice;
}

/**
 * Sums the money actually received. Refunds are their own row kind rather than
 * negative amounts, so they are subtracted explicitly.
 */
async function receivedMinor(tx: Prisma.TransactionClient, invoiceId: string): Promise<bigint> {
  const rows = await tx.payment.findMany({
    where: { invoiceId, status: 'COMPLETED' },
    select: { kind: true, amountMinor: true },
  });

  return rows.reduce(
    (total, row) => (row.kind === 'REFUND' ? total - row.amountMinor : total + row.amountMinor),
    0n,
  );
}

/**
 * Keeps the invoice status in step with the ledger.
 *
 * The status is derived from the payments rather than incremented by hand, so
 * a reversal reopens the invoice and a final payment settles it in the same
 * transaction that recorded the money.
 */
async function syncInvoiceStatus(
  tx: Prisma.TransactionClient,
  invoice: LockedInvoice,
): Promise<bigint> {
  const received = await receivedMinor(tx, invoice.id);

  if (received >= invoice.totalMinor) {
    await tx.invoice.update({
      where: { id: invoice.id },
      data: { status: 'PAID', paidAt: new Date() },
    });
  } else if (received > 0n) {
    await tx.invoice.update({
      where: { id: invoice.id },
      data: { status: 'PARTIALLY_PAID', paidAt: null },
    });
  } else {
    await tx.invoice.update({
      where: { id: invoice.id },
      data: { status: 'SENT', paidAt: null },
    });
  }

  return received;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002'
  );
}

export async function createPayment(
  workspaceId: string,
  actorId: string,
  actorEmail: string,
  input: CreatePaymentInput,
  meta: RequestMeta,
): Promise<{ payment: ReturnType<typeof paymentDto>; created: boolean }> {
  try {
    return await getPrisma().$transaction(async (tx) => {
      if (input.idempotencyKey !== undefined) {
        const replay = await tx.payment.findFirst({
          where: { workspaceId, idempotencyKey: input.idempotencyKey },
        });
        if (replay !== null) {
          return { payment: paymentDto(replay), created: false };
        }
      }

      const invoice = await lockInvoice(tx, workspaceId, input.invoiceId);
      if (!PAYABLE_STATUSES.includes(invoice.status)) {
        throw ApiError.conflict(
          invoice.status === 'PAID'
            ? 'This invoice is already settled.'
            : 'Only an issued invoice can receive a payment.',
        );
      }

      const amount = BigInt(input.amountMinor);
      const received = await receivedMinor(tx, invoice.id);
      const outstanding = invoice.totalMinor - received;
      if (outstanding <= 0n) {
        throw ApiError.conflict('This invoice is already settled.');
      }
      if (amount > outstanding) {
        throw ApiError.badRequest('The payment is larger than the outstanding balance.', [
          {
            path: 'amountMinor',
            message: `At most ${outstanding.toString()} minor units are still due.`,
          },
        ]);
      }

      const payment = await tx.payment.create({
        data: {
          workspaceId,
          invoiceId: invoice.id,
          kind: 'PAYMENT',
          status: 'COMPLETED',
          amountMinor: amount,
          currency: invoice.currency,
          method: input.method ?? 'BANK_TRANSFER',
          paidAt: utcDate(input.paidAt ?? todayIso()),
          reference: input.reference ?? null,
          notes: input.notes ?? null,
          recordedById: actorId,
          idempotencyKey: input.idempotencyKey ?? null,
        },
      });

      await syncInvoiceStatus(tx, invoice);

      await tx.auditLog.create({
        data: auditData({
          workspaceId,
          actorId,
          actorEmail,
          action: 'payment.recorded',
          entityType: 'Payment',
          entityId: payment.id,
          metadata: {
            invoiceId: invoice.id,
            invoiceNumber: invoice.number,
            amountMinor: amount.toString(),
          },
          ...meta,
        }),
      });

      return { payment: paymentDto(payment), created: true };
    });
  } catch (error) {
    // A concurrent retry with the same idempotency key loses the unique
    // constraint rather than the race; the winning row is the answer.
    if (input.idempotencyKey !== undefined && isUniqueViolation(error)) {
      const existing = await getPrisma().payment.findFirst({
        where: { workspaceId, idempotencyKey: input.idempotencyKey },
      });
      if (existing !== null) {
        return { payment: paymentDto(existing), created: false };
      }
    }
    throw error;
  }
}

export async function reversePayment(
  workspaceId: string,
  actorId: string,
  actorEmail: string,
  paymentId: string,
  input: ReversePaymentInput,
  meta: RequestMeta,
): Promise<ReturnType<typeof paymentDto>> {
  return getPrisma().$transaction(async (tx) => {
    const located = await tx.payment.findFirst({
      where: { id: paymentId, workspaceId },
      select: { id: true, invoiceId: true },
    });
    if (located === null) {
      throw ApiError.notFound('Payment');
    }

    // Lock the invoice first, in the same order as `createPayment`, so two
    // operations on one invoice cannot deadlock each other.
    const invoice = await lockInvoice(tx, workspaceId, located.invoiceId);

    const existing = await tx.payment.findFirstOrThrow({
      where: { id: paymentId, workspaceId },
      select: { id: true, status: true, amountMinor: true, kind: true },
    });
    if (existing.status === 'REVERSED') {
      throw ApiError.conflict('This payment has already been reversed.');
    }
    if (existing.status !== 'COMPLETED') {
      throw ApiError.conflict('Only a completed payment can be reversed.');
    }

    const payment = await tx.payment.update({
      where: { id: paymentId },
      data: { status: 'REVERSED', reversedAt: new Date() },
    });

    await syncInvoiceStatus(tx, invoice);

    await tx.auditLog.create({
      data: auditData({
        workspaceId,
        actorId,
        actorEmail,
        action: 'payment.reversed',
        entityType: 'Payment',
        entityId: paymentId,
        metadata: {
          invoiceId: invoice.id,
          invoiceNumber: invoice.number,
          amountMinor: existing.amountMinor.toString(),
          kind: existing.kind,
          ...(input.reason === undefined ? {} : { reason: input.reason }),
        },
        ...meta,
      }),
    });

    return paymentDto(payment);
  });
}

export async function listPayments(workspaceId: string, query: ListPaymentsQuery) {
  const pagination = toPagination(query);

  const where: Prisma.PaymentWhereInput = {
    workspaceId,
    ...(query.invoiceId === undefined ? {} : { invoiceId: query.invoiceId }),
    ...(query.kind === undefined ? {} : { kind: query.kind }),
    ...(query.status === undefined ? {} : { status: query.status }),
    ...(query.from === undefined && query.to === undefined
      ? {}
      : {
          paidAt: {
            ...(query.from === undefined ? {} : { gte: utcDate(query.from) }),
            ...(query.to === undefined ? {} : { lte: utcDate(query.to) }),
          },
        }),
  };

  const [total, rows] = await Promise.all([
    getPrisma().payment.count({ where }),
    getPrisma().payment.findMany({
      where,
      orderBy: [{ paidAt: 'desc' }, { createdAt: 'desc' }],
      skip: pagination.skip,
      take: pagination.take,
    }),
  ]);

  return { data: rows.map(paymentDto), meta: pageMeta(total, pagination) };
}
