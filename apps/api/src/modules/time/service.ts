import type { Prisma, WorkspaceRole } from '@prisma/client';

import { getPrisma } from '../../database/client';
import { billableValueMinor } from '../../domain/billing';
import { ApiError } from '../../http/errors';
import { money, pageMeta, toPagination } from '../../http/pagination';
import { can } from '../workspaces/permissions';
import { recordAudit } from '../audit/service';
import type { RequestMeta } from '../clients/service';
import type {
  CreateTimeEntryInput,
  ListTimeEntriesQuery,
  TimeSummaryQuery,
  UpdateTimeEntryInput,
} from './schemas';

function utcDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function optionalUtcDate(value: string | undefined): Date | undefined {
  return value === undefined ? undefined : utcDate(value);
}

function toIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function entryDto(entry: {
  id: string;
  projectId: string;
  taskId: string | null;
  userId: string;
  minutes: number;
  billable: boolean;
  hourlyRateMinor: bigint | null;
  date: Date;
  note: string | null;
  createdAt: Date;
  user?: { id: string; name: string } | undefined;
  project?: { id: string; name: string } | undefined;
  task?: { id: string; title: string } | null | undefined;
}) {
  return {
    id: entry.id,
    project: entry.project ?? { id: entry.projectId },
    task: entry.task === undefined ? null : entry.task,
    user: entry.user ?? { id: entry.userId },
    minutes: entry.minutes,
    billable: entry.billable,
    hourlyRateMinor: money(entry.hourlyRateMinor),
    valueMinor: money(
      entry.billable && entry.hourlyRateMinor !== null
        ? billableValueMinor([
            { minutes: entry.minutes, billable: true, hourlyRateMinor: entry.hourlyRateMinor },
          ])
        : 0n,
    ),
    date: toIsoDate(entry.date),
    note: entry.note,
    createdAt: entry.createdAt,
  };
}

async function requireProject(workspaceId: string, projectId: string): Promise<void> {
  const project = await getPrisma().project.findFirst({
    where: { id: projectId, workspaceId },
    select: { id: true },
  });
  if (project === null) {
    throw ApiError.notFound('Project');
  }
}

async function requireTask(projectId: string, taskId: string): Promise<void> {
  const task = await getPrisma().task.findFirst({
    where: { id: taskId, projectId },
    select: { id: true },
  });
  if (task === null) {
    throw ApiError.notFound('Task');
  }
}

/**
 * When a billable entry omits a rate, reuse the most recent rate the same
 * person charged the same project. It keeps weekly logging fast without
 * letting the server invent a number.
 */
async function inheritRate(userId: string, projectId: string): Promise<bigint | null> {
  const previous = await getPrisma().timeEntry.findFirst({
    where: { userId, projectId, hourlyRateMinor: { not: null } },
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    select: { hourlyRateMinor: true },
  });
  return previous?.hourlyRateMinor ?? null;
}

const ENTRY_INCLUDE = {
  user: { select: { id: true, name: true } },
  project: { select: { id: true, name: true } },
  task: { select: { id: true, title: true } },
} satisfies Prisma.TimeEntryInclude;

export async function listTimeEntries(
  workspaceId: string,
  role: WorkspaceRole,
  callerId: string,
  query: ListTimeEntriesQuery,
) {
  const pagination = toPagination(query);
  // Without the manage permission a member only ever sees their own time.
  const userId = can(role, 'time:manage') ? query.userId : callerId;

  const where: Prisma.TimeEntryWhereInput = {
    workspaceId,
    ...(userId === undefined ? {} : { userId }),
    ...(query.projectId === undefined ? {} : { projectId: query.projectId }),
    ...(query.taskId === undefined ? {} : { taskId: query.taskId }),
    ...(query.billable === undefined ? {} : { billable: query.billable }),
    ...(query.from === undefined && query.to === undefined
      ? {}
      : {
          date: {
            ...(query.from === undefined ? {} : { gte: optionalUtcDate(query.from) }),
            ...(query.to === undefined ? {} : { lte: optionalUtcDate(query.to) }),
          },
        }),
  };

  const [total, rows] = await Promise.all([
    getPrisma().timeEntry.count({ where }),
    getPrisma().timeEntry.findMany({
      where,
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      skip: pagination.skip,
      take: pagination.take,
      include: ENTRY_INCLUDE,
    }),
  ]);

  return { data: rows.map(entryDto), meta: pageMeta(total, pagination) };
}

export async function createTimeEntry(
  workspaceId: string,
  actorId: string,
  actorEmail: string,
  input: CreateTimeEntryInput,
  meta: RequestMeta,
) {
  await requireProject(workspaceId, input.projectId);
  if (input.taskId !== undefined) {
    await requireTask(input.projectId, input.taskId);
  }

  const rate =
    input.billable === false
      ? null
      : input.hourlyRateMinor !== undefined
        ? BigInt(input.hourlyRateMinor)
        : await inheritRate(actorId, input.projectId);

  const entry = await getPrisma().timeEntry.create({
    data: {
      workspaceId,
      projectId: input.projectId,
      taskId: input.taskId ?? null,
      userId: actorId,
      minutes: input.minutes,
      billable: input.billable,
      hourlyRateMinor: rate,
      date: utcDate(input.date),
      note: input.note ?? null,
    },
    include: ENTRY_INCLUDE,
  });

  await recordAudit({
    workspaceId,
    actorId,
    actorEmail,
    action: 'time.created',
    entityType: 'TimeEntry',
    entityId: entry.id,
    metadata: { projectId: entry.projectId, minutes: entry.minutes, billable: entry.billable },
    ...meta,
  });

  return entryDto(entry);
}

async function requireEntry(workspaceId: string, entryId: string) {
  const entry = await getPrisma().timeEntry.findFirst({
    where: { id: entryId, workspaceId },
    select: { id: true, userId: true, projectId: true, taskId: true },
  });
  if (entry === null) {
    throw ApiError.notFound('Time entry');
  }
  return entry;
}

function assertCanChange(entry: { userId: string }, callerId: string, role: WorkspaceRole): void {
  if (entry.userId !== callerId && !can(role, 'time:manage')) {
    // 404 rather than 403: a member may not learn that a colleague's entry id
    // exists when they are not allowed to touch it.
    throw ApiError.notFound('Time entry');
  }
}

export async function updateTimeEntry(
  workspaceId: string,
  actorId: string,
  actorEmail: string,
  role: WorkspaceRole,
  entryId: string,
  input: UpdateTimeEntryInput,
  meta: RequestMeta,
) {
  const existing = await requireEntry(workspaceId, entryId);
  assertCanChange(existing, actorId, role);

  const projectId = input.projectId ?? existing.projectId;
  const projectChanged = input.projectId !== undefined && input.projectId !== existing.projectId;
  if (input.projectId !== undefined) {
    await requireProject(workspaceId, input.projectId);
  }

  // Moving an entry to another project clears the task unless a new one is
  // supplied: a task id always belongs to exactly one project.
  const taskId =
    input.taskId === undefined ? (projectChanged ? null : existing.taskId) : input.taskId;
  if (taskId !== null) {
    await requireTask(projectId, taskId);
  }

  const rate =
    input.hourlyRateMinor === undefined
      ? input.billable === false
        ? null
        : undefined
      : input.hourlyRateMinor === null
        ? null
        : BigInt(input.hourlyRateMinor);

  const entry = await getPrisma().timeEntry.update({
    where: { id: entryId },
    data: {
      ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
      ...(input.taskId === undefined && !projectChanged ? {} : { taskId }),
      ...(input.minutes === undefined ? {} : { minutes: input.minutes }),
      ...(input.date === undefined ? {} : { date: utcDate(input.date) }),
      ...(input.note === undefined ? {} : { note: input.note }),
      ...(input.billable === undefined ? {} : { billable: input.billable }),
      ...(rate === undefined ? {} : { hourlyRateMinor: rate }),
    },
    include: ENTRY_INCLUDE,
  });

  await recordAudit({
    workspaceId,
    actorId,
    actorEmail,
    action: 'time.updated',
    entityType: 'TimeEntry',
    entityId: entryId,
    metadata: { fields: Object.keys(input) },
    ...meta,
  });

  return entryDto(entry);
}

export async function deleteTimeEntry(
  workspaceId: string,
  actorId: string,
  actorEmail: string,
  role: WorkspaceRole,
  entryId: string,
  meta: RequestMeta,
): Promise<void> {
  const existing = await requireEntry(workspaceId, entryId);
  assertCanChange(existing, actorId, role);

  await getPrisma().timeEntry.delete({ where: { id: entryId } });
  await recordAudit({
    workspaceId,
    actorId,
    actorEmail,
    action: 'time.deleted',
    entityType: 'TimeEntry',
    entityId: entryId,
    metadata: { projectId: existing.projectId },
    ...meta,
  });
}

interface SummaryBucket {
  minutes: number;
  billableMinutes: number;
  valueProduct: bigint;
}

function emptyBucket(): SummaryBucket {
  return { minutes: 0, billableMinutes: 0, valueProduct: 0n };
}

function addToBucket(
  bucket: SummaryBucket,
  entry: { minutes: number; billable: boolean; hourlyRateMinor: bigint | null },
): void {
  bucket.minutes += entry.minutes;
  if (entry.billable) {
    bucket.billableMinutes += entry.minutes;
    bucket.valueProduct += BigInt(entry.minutes) * (entry.hourlyRateMinor ?? 0n);
  }
}

function valueOf(bucket: SummaryBucket): string {
  return money(bucket.valueProduct === 0n ? 0n : (bucket.valueProduct + 30n) / 60n) ?? '0';
}

export async function timeSummary(
  workspaceId: string,
  role: WorkspaceRole,
  callerId: string,
  query: TimeSummaryQuery,
) {
  const userId = can(role, 'time:manage') ? undefined : callerId;
  const entries = await getPrisma().timeEntry.findMany({
    where: {
      workspaceId,
      ...(userId === undefined ? {} : { userId }),
      ...(query.projectId === undefined ? {} : { projectId: query.projectId }),
      date: { gte: optionalUtcDate(query.from), lte: optionalUtcDate(query.to) },
    },
    include: {
      user: { select: { id: true, name: true } },
      project: { select: { id: true, name: true } },
    },
    orderBy: { date: 'asc' },
  });

  const totals = emptyBucket();
  const byUser = new Map<string, SummaryBucket & { name: string }>();
  const byProject = new Map<string, SummaryBucket & { name: string }>();
  const byDay = new Map<string, SummaryBucket>();

  for (const entry of entries) {
    addToBucket(totals, entry);

    const user = byUser.get(entry.userId) ?? { ...emptyBucket(), name: entry.user.name };
    addToBucket(user, entry);
    byUser.set(entry.userId, user);

    const project = byProject.get(entry.projectId) ?? {
      ...emptyBucket(),
      name: entry.project.name,
    };
    addToBucket(project, entry);
    byProject.set(entry.projectId, project);

    const day = byDay.get(toIsoDate(entry.date)) ?? emptyBucket();
    addToBucket(day, entry);
    byDay.set(toIsoDate(entry.date), day);
  }

  return {
    range: { from: query.from, to: query.to },
    totals: {
      entries: entries.length,
      minutes: totals.minutes,
      billableMinutes: totals.billableMinutes,
      billableValueMinor: valueOf(totals),
    },
    byUser: [...byUser.entries()].map(([id, bucket]) => ({
      userId: id,
      name: bucket.name,
      minutes: bucket.minutes,
      billableMinutes: bucket.billableMinutes,
      billableValueMinor: valueOf(bucket),
    })),
    byProject: [...byProject.entries()].map(([id, bucket]) => ({
      projectId: id,
      name: bucket.name,
      minutes: bucket.minutes,
      billableMinutes: bucket.billableMinutes,
      billableValueMinor: valueOf(bucket),
    })),
    byDay: [...byDay.entries()]
      .map(([date, bucket]) => ({
        date,
        minutes: bucket.minutes,
        billableMinutes: bucket.billableMinutes,
      }))
      .sort((a, b) => a.date.localeCompare(b.date)),
  };
}
