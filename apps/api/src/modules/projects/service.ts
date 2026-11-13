import type { Prisma } from '@prisma/client';

import { getPrisma } from '../../database/client';
import { ApiError } from '../../http/errors';
import { money, pageMeta, toPagination } from '../../http/pagination';
import { recordAudit } from '../audit/service';
import type { RequestMeta } from '../clients/service';
import type { CreateProjectInput, ListProjectsQuery, UpdateProjectInput } from './schemas';

/**
 * Dates arrive as `YYYY-MM-DD` and are stored at UTC midnight. Keeping the
 * conversion in one place stops time-zone drift from turning a due date into
 * the previous day for users west of UTC.
 */
function toUtcDate(value: string | null | undefined): Date | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  return value === null ? null : new Date(`${value}T00:00:00.000Z`);
}

function toIsoDate(value: Date | null): string | null {
  return value === null ? null : value.toISOString().slice(0, 10);
}

function projectDto(project: {
  id: string;
  clientId: string;
  name: string;
  description: string | null;
  status: string;
  priority: string;
  startDate: Date | null;
  dueDate: Date | null;
  completedAt: Date | null;
  budgetMinor: bigint | null;
  currency: string;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  client: { id: string; name: string };
  _count: { tasks: number; timeEntries: number; invoices: number };
}) {
  return {
    id: project.id,
    client: project.client,
    name: project.name,
    description: project.description,
    status: project.status,
    priority: project.priority,
    startDate: toIsoDate(project.startDate),
    dueDate: toIsoDate(project.dueDate),
    completedAt: project.completedAt,
    budgetMinor: money(project.budgetMinor),
    currency: project.currency,
    archivedAt: project.archivedAt,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    counts: {
      tasks: project._count.tasks,
      timeEntries: project._count.timeEntries,
      invoices: project._count.invoices,
    },
  };
}

/** Loads a project scoped to its workspace, or throws a tenant-safe 404. */
async function requireProject(workspaceId: string, projectId: string) {
  const project = await getPrisma().project.findFirst({
    where: { id: projectId, workspaceId },
    select: { id: true, status: true, startDate: true, dueDate: true, archivedAt: true },
  });
  if (project === null) {
    throw ApiError.notFound('Project');
  }
  return project;
}

async function requireClient(workspaceId: string, clientId: string): Promise<void> {
  const client = await getPrisma().client.findFirst({
    where: { id: clientId, workspaceId, deletedAt: null },
    select: { id: true },
  });
  if (client === null) {
    throw ApiError.notFound('Client');
  }
}

export async function listProjects(workspaceId: string, query: ListProjectsQuery) {
  const pagination = toPagination(query);
  const where: Prisma.ProjectWhereInput = {
    workspaceId,
    ...(query.status === undefined ? {} : { status: query.status }),
    ...(query.clientId === undefined ? {} : { clientId: query.clientId }),
    ...(query.includeArchived ? {} : { archivedAt: null }),
    ...(query.search === undefined
      ? {}
      : {
          OR: [
            { name: { contains: query.search, mode: 'insensitive' } },
            { description: { contains: query.search, mode: 'insensitive' } },
            { client: { name: { contains: query.search, mode: 'insensitive' } } },
          ],
        }),
  };

  const [total, rows] = await Promise.all([
    getPrisma().project.count({ where }),
    getPrisma().project.findMany({
      where,
      orderBy: [{ [query.sort]: query.order }, { createdAt: 'desc' }],
      skip: pagination.skip,
      take: pagination.take,
      include: {
        client: { select: { id: true, name: true } },
        _count: { select: { tasks: true, timeEntries: true, invoices: true } },
      },
    }),
  ]);

  return { data: rows.map(projectDto), meta: pageMeta(total, pagination) };
}

export async function getProject(workspaceId: string, projectId: string) {
  const project = await getPrisma().project.findFirst({
    where: { id: projectId, workspaceId },
    include: {
      client: { select: { id: true, name: true } },
      _count: { select: { tasks: true, timeEntries: true, invoices: true } },
    },
  });
  if (project === null) {
    throw ApiError.notFound('Project');
  }

  const [entries, invoiced] = await Promise.all([
    getPrisma().timeEntry.findMany({
      where: { workspaceId, projectId },
      select: { minutes: true, billable: true, hourlyRateMinor: true },
    }),
    getPrisma().invoice.aggregate({
      where: { workspaceId, projectId, status: { notIn: ['DRAFT', 'CANCELLED', 'VOID'] } },
      _sum: { totalMinor: true },
      _count: true,
    }),
  ]);

  let loggedMinutes = 0;
  let billableMinutes = 0;
  let billableRateProduct = 0n;
  for (const entry of entries) {
    loggedMinutes += entry.minutes;
    if (entry.billable) {
      billableMinutes += entry.minutes;
      billableRateProduct += BigInt(entry.minutes) * (entry.hourlyRateMinor ?? 0n);
    }
  }

  // Rates are stored per hour while time is stored in minutes. Sum the
  // products first and divide once so per-entry truncation cannot accumulate.
  const billableValueMinor = billableRateProduct === 0n ? 0n : (billableRateProduct + 30n) / 60n;

  const budgetMinor = project.budgetMinor;
  const invoicedMinor = invoiced._sum.totalMinor ?? 0n;

  return {
    ...projectDto(project),
    time: {
      loggedMinutes,
      billableMinutes,
      billableValueMinor: money(billableValueMinor),
    },
    billing: {
      invoicedMinor: money(invoicedMinor),
      invoiceCount: invoiced._count,
      budgetMinor: money(budgetMinor),
      budgetRemainingMinor:
        budgetMinor === null
          ? null
          : money(budgetMinor > invoicedMinor ? budgetMinor - invoicedMinor : 0n),
    },
  };
}

export async function createProject(
  workspaceId: string,
  actorId: string,
  actorEmail: string,
  input: CreateProjectInput,
  meta: RequestMeta,
) {
  await requireClient(workspaceId, input.clientId);
  const workspace = await getPrisma().workspace.findUniqueOrThrow({
    where: { id: workspaceId },
    select: { currency: true },
  });

  const project = await getPrisma().project.create({
    data: {
      workspaceId,
      clientId: input.clientId,
      name: input.name,
      description: input.description ?? null,
      status: input.status ?? 'PLANNING',
      priority: input.priority ?? 'MEDIUM',
      startDate: toUtcDate(input.startDate) ?? null,
      dueDate: toUtcDate(input.dueDate) ?? null,
      budgetMinor: input.budgetMinor === undefined ? null : BigInt(input.budgetMinor),
      currency: input.currency ?? workspace.currency,
      completedAt: input.status === 'COMPLETED' ? new Date() : null,
    },
  });

  await recordAudit({
    workspaceId,
    actorId,
    actorEmail,
    action: 'project.created',
    entityType: 'Project',
    entityId: project.id,
    metadata: { name: project.name, clientId: project.clientId },
    ...meta,
  });

  return getProject(workspaceId, project.id);
}

export async function updateProject(
  workspaceId: string,
  actorId: string,
  actorEmail: string,
  projectId: string,
  input: UpdateProjectInput,
  meta: RequestMeta,
) {
  const existing = await requireProject(workspaceId, projectId);

  if (input.clientId !== undefined) {
    await requireClient(workspaceId, input.clientId);
  }

  const startDate =
    input.startDate === undefined ? existing.startDate : (toUtcDate(input.startDate) ?? null);
  const dueDate =
    input.dueDate === undefined ? existing.dueDate : (toUtcDate(input.dueDate) ?? null);
  if (startDate !== null && dueDate !== null && dueDate < startDate) {
    throw ApiError.badRequest('The due date cannot be before the start date.', { path: 'dueDate' });
  }

  const completedAt =
    input.status === undefined
      ? undefined
      : input.status === 'COMPLETED'
        ? existing.status === 'COMPLETED'
          ? undefined
          : new Date()
        : null;

  await getPrisma().project.update({
    where: { id: projectId },
    data: {
      ...(input.clientId === undefined ? {} : { clientId: input.clientId }),
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.description === undefined ? {} : { description: input.description }),
      ...(input.status === undefined ? {} : { status: input.status }),
      ...(input.priority === undefined ? {} : { priority: input.priority }),
      ...(input.startDate === undefined ? {} : { startDate: toUtcDate(input.startDate) }),
      ...(input.dueDate === undefined ? {} : { dueDate: toUtcDate(input.dueDate) }),
      ...(input.budgetMinor === undefined
        ? {}
        : { budgetMinor: input.budgetMinor === null ? null : BigInt(input.budgetMinor) }),
      ...(input.currency === undefined ? {} : { currency: input.currency }),
      ...(completedAt === undefined ? {} : { completedAt }),
    },
  });

  await recordAudit({
    workspaceId,
    actorId,
    actorEmail,
    action: 'project.updated',
    entityType: 'Project',
    entityId: projectId,
    metadata: { fields: Object.keys(input) },
    ...meta,
  });

  return getProject(workspaceId, projectId);
}

export async function setProjectArchived(
  workspaceId: string,
  actorId: string,
  actorEmail: string,
  projectId: string,
  archived: boolean,
  meta: RequestMeta,
) {
  await requireProject(workspaceId, projectId);

  await getPrisma().project.update({
    where: { id: projectId },
    data: { archivedAt: archived ? new Date() : null },
  });

  await recordAudit({
    workspaceId,
    actorId,
    actorEmail,
    action: archived ? 'project.archived' : 'project.restored',
    entityType: 'Project',
    entityId: projectId,
    ...meta,
  });

  return getProject(workspaceId, projectId);
}

/**
 * Deletes a project only while nothing financial depends on it. Once time or
 * invoices exist the project is history: archiving keeps the trail intact.
 */
export async function deleteProject(
  workspaceId: string,
  actorId: string,
  actorEmail: string,
  projectId: string,
  meta: RequestMeta,
): Promise<void> {
  await requireProject(workspaceId, projectId);

  const counts = await getPrisma().project.findUniqueOrThrow({
    where: { id: projectId },
    select: { _count: { select: { timeEntries: true, invoices: true, expenses: true } } },
  });

  const linked = counts._count.timeEntries + counts._count.invoices + counts._count.expenses > 0;
  if (linked) {
    throw ApiError.conflict(
      'This project has time entries, invoices or expenses. Archive it instead so records are preserved.',
    );
  }

  await getPrisma().project.delete({ where: { id: projectId } });

  await recordAudit({
    workspaceId,
    actorId,
    actorEmail,
    action: 'project.deleted',
    entityType: 'Project',
    entityId: projectId,
    ...meta,
  });
}
