import type { InvoiceStatus, Prisma } from '@prisma/client';

import { getPrisma } from '../../database/client';
import { invoiceTotals, lineTotals } from '../../domain/invoice';
import { ApiError } from '../../http/errors';
import { money, pageMeta, toPagination } from '../../http/pagination';
import { auditData } from '../audit/service';
import type { RequestMeta } from '../clients/service';
import {
  toLineInput,
  type CreateInvoiceInput,
  type LineItemInput,
  type ListInvoicesQuery,
  type UpdateInvoiceInput,
} from './schemas';

const OPEN_STATUSES: readonly InvoiceStatus[] = ['SENT', 'PARTIALLY_PAID'];

function invoiceInclude() {
  return {
    items: { orderBy: { position: 'asc' as const } },
    client: { select: { id: true, name: true, company: true, email: true } },
    project: { select: { id: true, name: true } },
    payments: {
      where: { status: 'COMPLETED' as const },
      select: { kind: true, amountMinor: true },
    },
  } satisfies Prisma.InvoiceInclude;
}

type InvoiceRow = Prisma.InvoiceGetPayload<{ include: ReturnType<typeof invoiceInclude> }>;

function utcDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/** Start of the current UTC day, used for the derived overdue state. */
function startOfToday(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * Refunds are payment rows with their own kind rather than negative amounts,
 * so `paid` has to subtract them explicitly.
 */
function paidMinor(payments: readonly { kind: string; amountMinor: bigint }[]): bigint {
  let total = 0n;
  for (const payment of payments) {
    total += payment.kind === 'REFUND' ? -payment.amountMinor : payment.amountMinor;
  }
  return total;
}

function itemDto(item: InvoiceRow['items'][number]) {
  return {
    id: item.id,
    description: item.description,
    quantityMilli: item.quantityMilli,
    unitPriceMinor: money(item.unitPriceMinor),
    discountMinor: money(item.discountMinor),
    taxRateBps: item.taxRateBps,
    totalMinor: money(item.totalMinor),
    position: item.position,
  };
}

function invoiceDto(invoice: InvoiceRow) {
  const paid = paidMinor(invoice.payments);
  const outstanding = invoice.totalMinor - paid;

  return {
    id: invoice.id,
    number: invoice.number,
    status: invoice.status,
    // OVERDUE is derived, not stored: an invoice becomes overdue with the
    // passage of time, not because a job rewrote its row at midnight.
    isOverdue:
      OPEN_STATUSES.includes(invoice.status) &&
      outstanding > 0n &&
      invoice.dueDate < startOfToday(),
    currency: invoice.currency,
    issueDate: isoDate(invoice.issueDate),
    dueDate: isoDate(invoice.dueDate),
    client: invoice.client,
    project: invoice.project,
    subtotalMinor: money(invoice.subtotalMinor),
    discountMinor: money(invoice.discountMinor),
    taxMinor: money(invoice.taxMinor),
    totalMinor: money(invoice.totalMinor),
    paidMinor: money(paid),
    dueMinor: money(outstanding > 0n ? outstanding : 0n),
    notes: invoice.notes,
    terms: invoice.terms,
    template: invoice.template,
    sentAt: invoice.sentAt,
    paidAt: invoice.paidAt,
    voidedAt: invoice.voidedAt,
    createdAt: invoice.createdAt,
    updatedAt: invoice.updatedAt,
    items: invoice.items.map(itemDto),
  };
}

async function fetchInvoice(
  db: Prisma.TransactionClient,
  workspaceId: string,
  invoiceId: string,
): Promise<ReturnType<typeof invoiceDto>> {
  const invoice = await db.invoice.findFirst({
    where: { id: invoiceId, workspaceId },
    include: invoiceInclude(),
  });
  if (invoice === null) {
    throw ApiError.notFound('Invoice');
  }
  return invoiceDto(invoice);
}

async function requireClient(
  db: Prisma.TransactionClient,
  workspaceId: string,
  clientId: string,
): Promise<void> {
  const client = await db.client.findFirst({
    where: { id: clientId, workspaceId, deletedAt: null },
    select: { id: true },
  });
  if (client === null) {
    throw ApiError.notFound('Client');
  }
}

async function assertProjectBelongsToClient(
  db: Prisma.TransactionClient,
  workspaceId: string,
  clientId: string,
  projectId: string,
): Promise<void> {
  const project = await db.project.findFirst({
    where: { id: projectId, workspaceId },
    select: { id: true, clientId: true },
  });
  if (project === null) {
    throw ApiError.notFound('Project');
  }
  if (project.clientId !== clientId) {
    throw ApiError.badRequest('The project does not belong to the invoice client.', [
      { path: 'projectId', message: 'The project belongs to a different client.' },
    ]);
  }
}

/**
 * Allocates the next number for a workspace.
 *
 * `nextInvoiceSequence` is incremented with an atomic UPDATE inside the
 * invoice transaction, so two simultaneous creates get different numbers and
 * a rollback gives the number back. The column holds the *next* number to
 * use, so the allocated serial is one less than the value the UPDATE returns.
 * Numbers are formatted with at least four digits; past 9999 they simply grow
 * (`INV-10000`).
 */
async function allocateNumber(
  tx: Prisma.TransactionClient,
  workspaceId: string,
): Promise<{ number: string; currency: string }> {
  const settings = await tx.workspace.update({
    where: { id: workspaceId },
    data: { nextInvoiceSequence: { increment: 1 } },
    select: { invoicePrefix: true, nextInvoiceSequence: true, currency: true },
  });

  const serial = settings.nextInvoiceSequence - 1;
  return {
    number: `${settings.invoicePrefix}-${String(serial).padStart(4, '0')}`,
    currency: settings.currency,
  };
}

function itemData(invoiceId: string, items: readonly LineItemInput[]) {
  return items.map((raw, position) => {
    const line = toLineInput(raw);
    return {
      invoiceId,
      description: line.description,
      quantityMilli: line.quantityMilli,
      unitPriceMinor: line.unitPriceMinor,
      discountMinor: line.discountMinor,
      taxRateBps: line.taxRateBps,
      totalMinor: lineTotals(line).totalMinor,
      position,
    };
  });
}

export async function createInvoice(
  workspaceId: string,
  actorId: string,
  actorEmail: string,
  input: CreateInvoiceInput,
  meta: RequestMeta,
) {
  return getPrisma().$transaction(async (tx) => {
    await requireClient(tx, workspaceId, input.clientId);
    if (input.projectId !== undefined) {
      await assertProjectBelongsToClient(tx, workspaceId, input.clientId, input.projectId);
    }

    const settings = await allocateNumber(tx, workspaceId);
    const lines = input.items.map(toLineInput);
    const totals = invoiceTotals(lines);

    const invoice = await tx.invoice.create({
      data: {
        workspaceId,
        clientId: input.clientId,
        projectId: input.projectId ?? null,
        number: settings.number,
        status: 'DRAFT',
        issueDate: utcDate(input.issueDate),
        dueDate: utcDate(input.dueDate),
        currency: input.currency ?? settings.currency,
        subtotalMinor: totals.subtotalMinor,
        discountMinor: totals.discountMinor,
        taxMinor: totals.taxMinor,
        totalMinor: totals.totalMinor,
        notes: input.notes ?? null,
        terms: input.terms ?? null,
        template: input.template ?? 'classic',
        createdById: actorId,
      },
      select: { id: true },
    });

    await tx.invoiceItem.createMany({ data: itemData(invoice.id, input.items) });

    await tx.auditLog.create({
      data: auditData({
        workspaceId,
        actorId,
        actorEmail,
        action: 'invoice.created',
        entityType: 'Invoice',
        entityId: invoice.id,
        metadata: {
          number: settings.number,
          totalMinor: totals.totalMinor.toString(),
          items: input.items.length,
        },
        ...meta,
      }),
    });

    return fetchInvoice(tx, workspaceId, invoice.id);
  });
}

export async function listInvoices(workspaceId: string, query: ListInvoicesQuery) {
  const pagination = toPagination(query);

  const where: Prisma.InvoiceWhereInput = { workspaceId };

  if (query.status === 'OVERDUE') {
    where.status = { in: [...OPEN_STATUSES] };
    where.dueDate = { lt: startOfToday() };
  } else if (query.status !== undefined) {
    where.status = query.status;
  }

  if (query.clientId !== undefined) {
    where.clientId = query.clientId;
  }
  if (query.projectId !== undefined) {
    where.projectId = query.projectId;
  }
  if (query.from !== undefined || query.to !== undefined) {
    where.issueDate = {
      ...(query.from === undefined ? {} : { gte: utcDate(query.from) }),
      ...(query.to === undefined ? {} : { lte: utcDate(query.to) }),
    };
  }
  if (query.search !== undefined) {
    where.OR = [
      { number: { contains: query.search, mode: 'insensitive' } },
      { client: { name: { contains: query.search, mode: 'insensitive' } } },
    ];
  }

  const [total, rows] = await Promise.all([
    getPrisma().invoice.count({ where }),
    getPrisma().invoice.findMany({
      where,
      orderBy: { [query.sort]: query.order },
      skip: pagination.skip,
      take: pagination.take,
      include: invoiceInclude(),
    }),
  ]);

  return { data: rows.map(invoiceDto), meta: pageMeta(total, pagination) };
}

export async function getInvoice(workspaceId: string, invoiceId: string) {
  return fetchInvoice(getPrisma(), workspaceId, invoiceId);
}

export async function updateInvoice(
  workspaceId: string,
  actorId: string,
  actorEmail: string,
  invoiceId: string,
  input: UpdateInvoiceInput,
  meta: RequestMeta,
) {
  return getPrisma().$transaction(async (tx) => {
    const existing = await tx.invoice.findFirst({
      where: { id: invoiceId, workspaceId },
      select: {
        id: true,
        status: true,
        clientId: true,
        projectId: true,
        issueDate: true,
        dueDate: true,
      },
    });
    if (existing === null) {
      throw ApiError.notFound('Invoice');
    }
    if (existing.status !== 'DRAFT') {
      throw ApiError.conflict('Only a draft invoice can be edited. Void it and issue a new one.');
    }

    const clientId = input.clientId ?? existing.clientId;
    if (input.clientId !== undefined) {
      await requireClient(tx, workspaceId, input.clientId);
    }

    const projectId = input.projectId === undefined ? existing.projectId : input.projectId;
    if (projectId !== null) {
      await assertProjectBelongsToClient(tx, workspaceId, clientId, projectId);
    }

    const issueDate = input.issueDate === undefined ? existing.issueDate : utcDate(input.issueDate);
    const dueDate = input.dueDate === undefined ? existing.dueDate : utcDate(input.dueDate);
    if (dueDate < issueDate) {
      throw ApiError.badRequest('The due date cannot be before the issue date.', [
        { path: 'dueDate', message: 'The due date cannot be before the issue date.' },
      ]);
    }

    let totals:
      | { subtotalMinor: bigint; discountMinor: bigint; taxMinor: bigint; totalMinor: bigint }
      | undefined;
    if (input.items !== undefined) {
      totals = invoiceTotals(input.items.map(toLineInput));
      await tx.invoiceItem.deleteMany({ where: { invoiceId } });
      await tx.invoiceItem.createMany({ data: itemData(invoiceId, input.items) });
    }

    await tx.invoice.update({
      where: { id: invoiceId },
      data: {
        ...(input.clientId === undefined ? {} : { clientId: input.clientId }),
        ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
        ...(input.issueDate === undefined ? {} : { issueDate }),
        ...(input.dueDate === undefined ? {} : { dueDate }),
        ...(input.currency === undefined ? {} : { currency: input.currency }),
        ...(input.notes === undefined ? {} : { notes: input.notes }),
        ...(input.terms === undefined ? {} : { terms: input.terms }),
        ...(input.template === undefined ? {} : { template: input.template }),
        ...(totals === undefined
          ? {}
          : {
              subtotalMinor: totals.subtotalMinor,
              discountMinor: totals.discountMinor,
              taxMinor: totals.taxMinor,
              totalMinor: totals.totalMinor,
            }),
      },
    });

    await tx.auditLog.create({
      data: auditData({
        workspaceId,
        actorId,
        actorEmail,
        action: 'invoice.updated',
        entityType: 'Invoice',
        entityId: invoiceId,
        metadata: { fields: Object.keys(input) },
        ...meta,
      }),
    });

    return fetchInvoice(tx, workspaceId, invoiceId);
  });
}

export async function issueInvoice(
  workspaceId: string,
  actorId: string,
  actorEmail: string,
  invoiceId: string,
  meta: RequestMeta,
) {
  return getPrisma().$transaction(async (tx) => {
    const existing = await tx.invoice.findFirst({
      where: { id: invoiceId, workspaceId },
      select: { id: true, status: true, number: true, _count: { select: { items: true } } },
    });
    if (existing === null) {
      throw ApiError.notFound('Invoice');
    }
    if (existing.status !== 'DRAFT') {
      throw ApiError.conflict('Only a draft invoice can be issued.');
    }
    if (existing._count.items === 0) {
      throw ApiError.badRequest('Add at least one line item before issuing this invoice.');
    }

    const sentAt = new Date();
    await tx.invoice.update({
      where: { id: invoiceId },
      data: { status: 'SENT', sentAt },
    });

    await tx.auditLog.create({
      data: auditData({
        workspaceId,
        actorId,
        actorEmail,
        action: 'invoice.issued',
        entityType: 'Invoice',
        entityId: invoiceId,
        metadata: { number: existing.number },
        ...meta,
      }),
    });

    return fetchInvoice(tx, workspaceId, invoiceId);
  });
}

export async function voidInvoice(
  workspaceId: string,
  actorId: string,
  actorEmail: string,
  invoiceId: string,
  meta: RequestMeta,
) {
  return getPrisma().$transaction(async (tx) => {
    const existing = await tx.invoice.findFirst({
      where: { id: invoiceId, workspaceId },
      select: { id: true, status: true, number: true },
    });
    if (existing === null) {
      throw ApiError.notFound('Invoice');
    }
    if (existing.status === 'VOID') {
      throw ApiError.conflict('This invoice has already been voided.');
    }
    if (existing.status === 'PAID' || existing.status === 'CANCELLED') {
      throw ApiError.conflict('A settled invoice cannot be voided.');
    }

    // Money already received must be reversed first; voiding would otherwise
    // hide a completed payment behind a cancelled document.
    const payments = await tx.payment.count({
      where: { invoiceId, status: 'COMPLETED' },
    });
    if (payments > 0) {
      throw ApiError.conflict('Reverse the payments before voiding this invoice.');
    }

    await tx.invoice.update({
      where: { id: invoiceId },
      data: { status: 'VOID', voidedAt: new Date() },
    });

    await tx.auditLog.create({
      data: auditData({
        workspaceId,
        actorId,
        actorEmail,
        action: 'invoice.voided',
        entityType: 'Invoice',
        entityId: invoiceId,
        metadata: { number: existing.number, previousStatus: existing.status },
        ...meta,
      }),
    });

    return fetchInvoice(tx, workspaceId, invoiceId);
  });
}

export async function deleteInvoice(
  workspaceId: string,
  actorId: string,
  actorEmail: string,
  invoiceId: string,
  meta: RequestMeta,
): Promise<void> {
  await getPrisma().$transaction(async (tx) => {
    const existing = await tx.invoice.findFirst({
      where: { id: invoiceId, workspaceId },
      select: { id: true, status: true, number: true },
    });
    if (existing === null) {
      throw ApiError.notFound('Invoice');
    }
    if (existing.status !== 'DRAFT') {
      throw ApiError.conflict(
        'A client has already seen this invoice; void it instead of deleting.',
      );
    }

    await tx.invoice.delete({ where: { id: invoiceId } });
    await tx.auditLog.create({
      data: auditData({
        workspaceId,
        actorId,
        actorEmail,
        action: 'invoice.deleted',
        entityType: 'Invoice',
        entityId: invoiceId,
        metadata: { number: existing.number },
        ...meta,
      }),
    });
  });
}
