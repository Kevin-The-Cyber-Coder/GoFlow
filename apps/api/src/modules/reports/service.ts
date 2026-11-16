import { getPrisma } from '../../database/client';
import { money } from '../../http/pagination';
import type { ReportSummaryQuery } from './schemas';

function utcDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

/** A date-only `to` includes the whole UTC day, not just its first millisecond. */
function endOfDay(value: string): Date {
  return new Date(`${value}T23:59:59.999Z`);
}

/**
 * The money summary for one currency and one period.
 *
 * The three numbers are deliberately defined by what actually moved, not by
 * what was invoiced:
 *
 * - `incomeMinor` sums completed payments minus completed refunds by the date
 *   the money was paid. A reversed payment has status REVERSED and is
 *   therefore excluded — a bounced transfer must never look like income.
 * - `expensesMinor` counts approved expenses only. Submitted and rejected
 *   rows have not been accepted as business spending yet.
 * - `outstandingMinor` is money invoiced but not received: open invoices
 *   issued in the period, each reduced by the completed ledger against it.
 *
 * Amounts in another currency are excluded rather than converted, because a
 * report that silently adds USD and EUR is worse than one that says which
 * currency it covers.
 */
export async function reportSummary(workspaceId: string, query: ReportSummaryQuery) {
  const prisma = getPrisma();
  const workspace = await prisma.workspace.findUniqueOrThrow({
    where: { id: workspaceId },
    select: { currency: true },
  });

  const currency = query.currency ?? workspace.currency;
  const from = utcDate(query.from);
  const to = endOfDay(query.to);

  const [payments, expenseTotals, invoices] = await Promise.all([
    prisma.payment.findMany({
      where: {
        workspaceId,
        currency,
        status: 'COMPLETED',
        paidAt: { gte: from, lte: to },
      },
      select: { kind: true, amountMinor: true },
    }),
    prisma.expense.aggregate({
      where: { workspaceId, currency, status: 'APPROVED', date: { gte: from, lte: to } },
      _sum: { amountMinor: true },
      _count: { _all: true },
    }),
    prisma.invoice.findMany({
      where: {
        workspaceId,
        currency,
        status: { in: ['SENT', 'PARTIALLY_PAID'] },
        issueDate: { gte: from, lte: to },
      },
      select: {
        totalMinor: true,
        payments: {
          where: { status: 'COMPLETED' },
          select: { kind: true, amountMinor: true },
        },
      },
    }),
  ]);

  const incomeMinor = payments.reduce(
    (total, payment) =>
      payment.kind === 'REFUND' ? total - payment.amountMinor : total + payment.amountMinor,
    0n,
  );
  const expensesMinor = expenseTotals._sum.amountMinor ?? 0n;

  let outstandingMinor = 0n;
  let outstandingInvoiceCount = 0;
  for (const invoice of invoices) {
    const received = invoice.payments.reduce(
      (total, payment) =>
        payment.kind === 'REFUND' ? total - payment.amountMinor : total + payment.amountMinor,
      0n,
    );
    const due = invoice.totalMinor - received;
    if (due > 0n) {
      outstandingMinor += due;
      outstandingInvoiceCount += 1;
    }
  }

  return {
    currency,
    from: query.from,
    to: query.to,
    incomeMinor: money(incomeMinor),
    expensesMinor: money(expensesMinor),
    netMinor: money(incomeMinor - expensesMinor),
    outstandingMinor: money(outstandingMinor),
    paymentCount: payments.length,
    expenseCount: expenseTotals._count._all,
    outstandingInvoiceCount,
  };
}
