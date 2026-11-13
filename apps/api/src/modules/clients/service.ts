import type { ClientStatus, Prisma } from '@prisma/client';

import { getPrisma } from '../../database/client';
import { money, pageMeta, toPagination } from '../../http/pagination';
import { ApiError } from '../../http/errors';
import { recordAudit } from '../audit/service';
import type { CreateClientInput, ListClientsQuery, UpdateClientInput } from './schemas';

export interface RequestMeta {
  readonly ip?: string | null;
  readonly userAgent?: string | null;
}

export interface ContactInput {
  readonly name: string;
  readonly email?: string | undefined;
  readonly phone?: string | undefined;
  readonly title?: string | undefined;
  readonly isPrimary?: boolean | undefined;
}

function contactDto(contact: {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  title: string | null;
  isPrimary: boolean;
}) {
  return {
    id: contact.id,
    name: contact.name,
    email: contact.email,
    phone: contact.phone,
    title: contact.title,
    isPrimary: contact.isPrimary,
  };
}

export async function listClients(workspaceId: string, query: ListClientsQuery) {
  const prisma = getPrisma();
  const pagination = toPagination(query);

  const where: Prisma.ClientWhereInput = {
    workspaceId,
    deletedAt: null,
    ...(query.status === undefined ? {} : { status: query.status }),
    ...(query.category === undefined ? {} : { category: query.category }),
    ...(query.includeArchived ? {} : { archivedAt: null }),
    ...(query.search === undefined
      ? {}
      : {
          OR: [
            { name: { contains: query.search, mode: 'insensitive' } },
            { company: { contains: query.search, mode: 'insensitive' } },
            { email: { contains: query.search, mode: 'insensitive' } },
          ],
        }),
  };

  const [total, rows] = await Promise.all([
    prisma.client.count({ where }),
    prisma.client.findMany({
      where,
      orderBy: { [query.sort]: query.order },
      skip: pagination.skip,
      take: pagination.take,
      include: { _count: { select: { projects: true, invoices: true, contacts: true } } },
    }),
  ]);

  return {
    data: rows.map((client) => ({
      id: client.id,
      name: client.name,
      company: client.company,
      email: client.email,
      phone: client.phone,
      category: client.category,
      status: client.status,
      tags: client.tags,
      archivedAt: client.archivedAt,
      createdAt: client.createdAt,
      counts: {
        projects: client._count.projects,
        invoices: client._count.invoices,
        contacts: client._count.contacts,
      },
    })),
    meta: pageMeta(total, pagination),
  };
}

export async function getClient(workspaceId: string, clientId: string) {
  const prisma = getPrisma();

  const client = await prisma.client.findFirst({
    where: { id: clientId, workspaceId, deletedAt: null },
    include: {
      contacts: { orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }] },
      _count: { select: { projects: true, invoices: true } },
    },
  });

  if (client === null) {
    throw ApiError.notFound('Client');
  }

  // Money is aggregated on the server. The client-facing app never sums
  // financial values itself.
  const [invoiced, paid, refunded, lastInvoice] = await Promise.all([
    prisma.invoice.aggregate({
      where: {
        workspaceId,
        clientId,
        status: { notIn: ['DRAFT', 'CANCELLED', 'VOID'] },
      },
      _sum: { totalMinor: true },
      _count: true,
    }),
    prisma.payment.aggregate({
      where: {
        workspaceId,
        status: 'COMPLETED',
        kind: 'PAYMENT',
        invoice: { clientId },
      },
      _sum: { amountMinor: true },
    }),
    prisma.payment.aggregate({
      where: {
        workspaceId,
        status: 'COMPLETED',
        kind: 'REFUND',
        invoice: { clientId },
      },
      _sum: { amountMinor: true },
    }),
    prisma.invoice.findFirst({
      where: { workspaceId, clientId },
      orderBy: { issueDate: 'desc' },
      select: { id: true, number: true, status: true, totalMinor: true, dueDate: true },
    }),
  ]);

  const invoicedMinor = invoiced._sum.totalMinor ?? 0n;
  const netPaid = (paid._sum.amountMinor ?? 0n) + (refunded._sum.amountMinor ?? 0n) * -1n;
  const outstanding = invoicedMinor - netPaid;

  return {
    id: client.id,
    name: client.name,
    company: client.company,
    email: client.email,
    phone: client.phone,
    billingAddress: {
      line1: client.billingLine1,
      line2: client.billingLine2,
      city: client.billingCity,
      postalCode: client.billingPostal,
      country: client.billingCountry,
    },
    category: client.category,
    status: client.status,
    notes: client.notes,
    tags: client.tags,
    archivedAt: client.archivedAt,
    createdAt: client.createdAt,
    updatedAt: client.updatedAt,
    contacts: client.contacts.map(contactDto),
    counts: {
      projects: client._count.projects,
      invoices: client._count.invoices,
    },
    financials: {
      invoicedMinor: money(invoicedMinor),
      paidMinor: money(netPaid),
      outstandingMinor: money(outstanding > 0n ? outstanding : 0n),
      invoiceCount: invoiced._count,
      lastInvoice:
        lastInvoice === null
          ? null
          : {
              id: lastInvoice.id,
              number: lastInvoice.number,
              status: lastInvoice.status,
              totalMinor: money(lastInvoice.totalMinor),
              dueDate: lastInvoice.dueDate,
            },
    },
  };
}

export async function createClient(
  workspaceId: string,
  actorId: string,
  actorEmail: string,
  input: CreateClientInput,
  meta: RequestMeta,
) {
  const prisma = getPrisma();

  // Duplicate detection: an e-mail is a strong identity signal; without one,
  // fall back to the normalised name.
  const duplicate = await prisma.client.findFirst({
    where: {
      workspaceId,
      deletedAt: null,
      ...(input.email === undefined
        ? { name: { equals: input.name, mode: 'insensitive' } }
        : { email: input.email }),
    },
    select: { id: true },
  });

  if (duplicate !== null) {
    throw new ApiError(409, 'DUPLICATE_CLIENT', 'A matching client already exists.', {
      clientId: duplicate.id,
    });
  }

  const client = await prisma.client.create({
    data: {
      workspaceId,
      createdById: actorId,
      name: input.name,
      company: input.company ?? null,
      email: input.email ?? null,
      phone: input.phone ?? null,
      billingLine1: input.billingLine1 ?? null,
      billingLine2: input.billingLine2 ?? null,
      billingCity: input.billingCity ?? null,
      billingPostal: input.billingPostal ?? null,
      billingCountry: input.billingCountry ?? null,
      category: input.category ?? null,
      status: (input.status ?? 'ACTIVE') as ClientStatus,
      notes: input.notes ?? null,
      tags: input.tags ?? [],
    },
  });

  await recordAudit({
    workspaceId,
    actorId,
    actorEmail,
    action: 'client.created',
    entityType: 'Client',
    entityId: client.id,
    metadata: { name: client.name },
    ...meta,
  });

  return client;
}

export async function updateClient(
  workspaceId: string,
  actorId: string,
  actorEmail: string,
  clientId: string,
  input: UpdateClientInput,
  meta: RequestMeta,
) {
  const prisma = getPrisma();
  const existing = await prisma.client.findFirst({
    where: { id: clientId, workspaceId, deletedAt: null },
    select: { id: true, status: true },
  });
  if (existing === null) {
    throw ApiError.notFound('Client');
  }
  if (existing.status === 'ARCHIVED') {
    throw ApiError.badRequest('Restore this client before editing it.');
  }

  const updated = await prisma.client.update({
    where: { id: clientId },
    data: {
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.company === undefined ? {} : { company: input.company }),
      ...(input.email === undefined ? {} : { email: input.email }),
      ...(input.phone === undefined ? {} : { phone: input.phone }),
      ...(input.billingLine1 === undefined ? {} : { billingLine1: input.billingLine1 }),
      ...(input.billingLine2 === undefined ? {} : { billingLine2: input.billingLine2 }),
      ...(input.billingCity === undefined ? {} : { billingCity: input.billingCity }),
      ...(input.billingPostal === undefined ? {} : { billingPostal: input.billingPostal }),
      ...(input.billingCountry === undefined ? {} : { billingCountry: input.billingCountry }),
      ...(input.category === undefined ? {} : { category: input.category }),
      ...(input.status === undefined ? {} : { status: input.status }),
      ...(input.notes === undefined ? {} : { notes: input.notes }),
      ...(input.tags === undefined ? {} : { tags: input.tags }),
    },
  });

  await recordAudit({
    workspaceId,
    actorId,
    actorEmail,
    action: 'client.updated',
    entityType: 'Client',
    entityId: clientId,
    metadata: { fields: Object.keys(input) },
    ...meta,
  });

  return updated;
}

export async function setClientArchived(
  workspaceId: string,
  actorId: string,
  actorEmail: string,
  clientId: string,
  archived: boolean,
  meta: RequestMeta,
) {
  const prisma = getPrisma();
  const existing = await prisma.client.findFirst({
    where: { id: clientId, workspaceId, deletedAt: null },
    select: { id: true },
  });
  if (existing === null) {
    throw ApiError.notFound('Client');
  }

  const client = await prisma.client.update({
    where: { id: clientId },
    data: {
      archivedAt: archived ? new Date() : null,
      status: archived ? 'ARCHIVED' : 'ACTIVE',
    },
  });

  await recordAudit({
    workspaceId,
    actorId,
    actorEmail,
    action: archived ? 'client.archived' : 'client.restored',
    entityType: 'Client',
    entityId: clientId,
    ...meta,
  });

  return client;
}

/**
 * Soft deletes the client. Financial history (invoices, payments) is kept:
 * those rows reference the client and must remain readable.
 */
export async function deleteClient(
  workspaceId: string,
  actorId: string,
  actorEmail: string,
  clientId: string,
  meta: RequestMeta,
): Promise<void> {
  const prisma = getPrisma();
  const existing = await prisma.client.findFirst({
    where: { id: clientId, workspaceId, deletedAt: null },
    select: { id: true, _count: { select: { invoices: true } } },
  });
  if (existing === null) {
    throw ApiError.notFound('Client');
  }
  if (existing._count.invoices > 0) {
    throw ApiError.conflict(
      'This client has invoices. Archive the client instead so financial history is preserved.',
    );
  }

  await prisma.client.update({ where: { id: clientId }, data: { deletedAt: new Date() } });

  await recordAudit({
    workspaceId,
    actorId,
    actorEmail,
    action: 'client.deleted',
    entityType: 'Client',
    entityId: clientId,
    ...meta,
  });
}

export async function addContact(
  workspaceId: string,
  actorId: string,
  actorEmail: string,
  clientId: string,
  input: ContactInput,
  meta: RequestMeta,
) {
  const prisma = getPrisma();
  const client = await prisma.client.findFirst({
    where: { id: clientId, workspaceId, deletedAt: null },
    select: { id: true },
  });
  if (client === null) {
    throw ApiError.notFound('Client');
  }

  const contact = await prisma.$transaction(async (tx) => {
    if (input.isPrimary === true) {
      await tx.clientContact.updateMany({ where: { clientId }, data: { isPrimary: false } });
    }
    return tx.clientContact.create({
      data: {
        clientId,
        name: input.name,
        email: input.email ?? null,
        phone: input.phone ?? null,
        title: input.title ?? null,
        isPrimary: input.isPrimary ?? false,
      },
    });
  });

  await recordAudit({
    workspaceId,
    actorId,
    actorEmail,
    action: 'client.contact_added',
    entityType: 'ClientContact',
    entityId: contact.id,
    metadata: { clientId },
    ...meta,
  });

  return contact;
}

export async function updateContact(
  workspaceId: string,
  actorId: string,
  actorEmail: string,
  clientId: string,
  contactId: string,
  input: Partial<ContactInput>,
  meta: RequestMeta,
) {
  const prisma = getPrisma();
  const contact = await prisma.clientContact.findFirst({
    where: { id: contactId, client: { id: clientId, workspaceId, deletedAt: null } },
    select: { id: true },
  });
  if (contact === null) {
    throw ApiError.notFound('Contact');
  }

  const updated = await prisma.$transaction(async (tx) => {
    if (input.isPrimary === true) {
      await tx.clientContact.updateMany({
        where: { clientId, id: { not: contactId } },
        data: { isPrimary: false },
      });
    }
    return tx.clientContact.update({
      where: { id: contactId },
      data: {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.email === undefined ? {} : { email: input.email }),
        ...(input.phone === undefined ? {} : { phone: input.phone }),
        ...(input.title === undefined ? {} : { title: input.title }),
        ...(input.isPrimary === undefined ? {} : { isPrimary: input.isPrimary }),
      },
    });
  });

  await recordAudit({
    workspaceId,
    actorId,
    actorEmail,
    action: 'client.contact_updated',
    entityType: 'ClientContact',
    entityId: contactId,
    metadata: { clientId, fields: Object.keys(input) },
    ...meta,
  });

  return updated;
}

export async function deleteContact(
  workspaceId: string,
  actorId: string,
  actorEmail: string,
  clientId: string,
  contactId: string,
  meta: RequestMeta,
): Promise<void> {
  const prisma = getPrisma();
  const contact = await prisma.clientContact.findFirst({
    where: { id: contactId, client: { id: clientId, workspaceId, deletedAt: null } },
    select: { id: true },
  });
  if (contact === null) {
    throw ApiError.notFound('Contact');
  }

  await prisma.clientContact.delete({ where: { id: contactId } });
  await recordAudit({
    workspaceId,
    actorId,
    actorEmail,
    action: 'client.contact_removed',
    entityType: 'ClientContact',
    entityId: contactId,
    metadata: { clientId },
    ...meta,
  });
}
