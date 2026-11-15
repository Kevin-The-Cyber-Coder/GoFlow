import type { Prisma, TaskStatus } from '@prisma/client';

import { getPrisma } from '../../database/client';
import { ApiError } from '../../http/errors';
import { recordAudit } from '../audit/service';
import type { RequestMeta } from '../clients/service';
import type {
  CreateTaskInput,
  ListTasksQuery,
  ReorderTasksInput,
  UpdateTaskInput,
} from './task-schemas';

function toUtcDate(value: string | null | undefined): Date | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  return value === null ? null : new Date(`${value}T00:00:00.000Z`);
}

function toIsoDate(value: Date | null): string | null {
  return value === null ? null : value.toISOString().slice(0, 10);
}

function taskDto(task: {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  dueDate: Date | null;
  estimateMinutes: number | null;
  position: number;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: task.id,
    projectId: task.projectId,
    title: task.title,
    description: task.description,
    status: task.status,
    dueDate: toIsoDate(task.dueDate),
    estimateMinutes: task.estimateMinutes,
    position: task.position,
    completedAt: task.completedAt,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
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

export async function listTasks(workspaceId: string, projectId: string, query: ListTasksQuery) {
  await requireProject(workspaceId, projectId);
  const prisma = getPrisma();

  const where: Prisma.TaskWhereInput = {
    workspaceId,
    projectId,
    ...(query.status === undefined ? {} : { status: query.status }),
    ...(query.search === undefined
      ? {}
      : {
          OR: [
            { title: { contains: query.search, mode: 'insensitive' } },
            { description: { contains: query.search, mode: 'insensitive' } },
          ],
        }),
  };

  const [tasks, statusCounts] = await Promise.all([
    prisma.task.findMany({
      where,
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      take: 1_000,
    }),
    prisma.task.groupBy({ by: ['status'], where: { workspaceId, projectId }, _count: true }),
  ]);

  const summary: Record<string, number> = { TODO: 0, IN_PROGRESS: 0, BLOCKED: 0, DONE: 0 };
  for (const group of statusCounts) {
    summary[group.status] = typeof group._count === 'number' ? group._count : 0;
  }

  return { data: tasks.map(taskDto), summary };
}

export async function createTask(
  workspaceId: string,
  actorId: string,
  actorEmail: string,
  projectId: string,
  input: CreateTaskInput,
  meta: RequestMeta,
) {
  await requireProject(workspaceId, projectId);
  const prisma = getPrisma();
  const status: TaskStatus = input.status ?? 'TODO';

  const last = await prisma.task.findFirst({
    where: { workspaceId, projectId, status },
    orderBy: { position: 'desc' },
    select: { position: true },
  });

  const task = await prisma.task.create({
    data: {
      workspaceId,
      projectId,
      title: input.title,
      description: input.description ?? null,
      status,
      dueDate: toUtcDate(input.dueDate) ?? null,
      estimateMinutes: input.estimateMinutes ?? null,
      position: (last?.position ?? -1) + 1,
      completedAt: status === 'DONE' ? new Date() : null,
    },
  });

  await recordAudit({
    workspaceId,
    actorId,
    actorEmail,
    action: 'task.created',
    entityType: 'Task',
    entityId: task.id,
    metadata: { projectId, title: task.title },
    ...meta,
  });

  return taskDto(task);
}

async function requireTask(workspaceId: string, projectId: string, taskId: string) {
  const task = await getPrisma().task.findFirst({
    where: { id: taskId, workspaceId, projectId },
    select: { id: true, status: true },
  });
  if (task === null) {
    throw ApiError.notFound('Task');
  }
  return task;
}

export async function updateTask(
  workspaceId: string,
  actorId: string,
  actorEmail: string,
  projectId: string,
  taskId: string,
  input: UpdateTaskInput,
  meta: RequestMeta,
) {
  const existing = await requireTask(workspaceId, projectId, taskId);
  const prisma = getPrisma();

  const completedAt =
    input.status === undefined
      ? undefined
      : input.status === 'DONE'
        ? existing.status === 'DONE'
          ? undefined
          : new Date()
        : null;

  // Moving to a different column puts the task at the bottom of that column;
  // keeping the old position would interleave it arbitrarily.
  let position: number | undefined;
  if (input.status !== undefined && input.status !== existing.status) {
    const last = await prisma.task.findFirst({
      where: { workspaceId, projectId, status: input.status },
      orderBy: { position: 'desc' },
      select: { position: true },
    });
    position = (last?.position ?? -1) + 1;
  }

  const task = await prisma.task.update({
    where: { id: taskId },
    data: {
      ...(input.title === undefined ? {} : { title: input.title }),
      ...(input.description === undefined ? {} : { description: input.description }),
      ...(input.status === undefined ? {} : { status: input.status }),
      ...(input.dueDate === undefined ? {} : { dueDate: toUtcDate(input.dueDate) }),
      ...(input.estimateMinutes === undefined ? {} : { estimateMinutes: input.estimateMinutes }),
      ...(completedAt === undefined ? {} : { completedAt }),
      ...(position === undefined ? {} : { position }),
    },
  });

  await recordAudit({
    workspaceId,
    actorId,
    actorEmail,
    action: 'task.updated',
    entityType: 'Task',
    entityId: taskId,
    metadata: { projectId, fields: Object.keys(input) },
    ...meta,
  });

  return taskDto(task);
}

/**
 * Rewrites positions for one column in a single transaction. Ids must all
 * belong to the project and the target column; a partially applied reorder
 * would scramble the board, so validation happens before any write.
 */
export async function reorderTasks(
  workspaceId: string,
  actorId: string,
  actorEmail: string,
  projectId: string,
  input: ReorderTasksInput,
  meta: RequestMeta,
) {
  await requireProject(workspaceId, projectId);
  const prisma = getPrisma();

  if (new Set(input.orderedIds).size !== input.orderedIds.length) {
    throw ApiError.badRequest('The order contains the same task twice.');
  }

  if (input.orderedIds.length > 0) {
    const found = await prisma.task.findMany({
      where: { id: { in: input.orderedIds }, workspaceId, projectId, status: input.status },
      select: { id: true },
    });
    if (found.length !== input.orderedIds.length) {
      throw ApiError.badRequest('Every task in the order must exist in this project and column.', {
        status: input.status,
      });
    }
  }

  await prisma.$transaction(
    input.orderedIds.map((id, index) =>
      prisma.task.update({ where: { id }, data: { position: index } }),
    ),
  );

  await recordAudit({
    workspaceId,
    actorId,
    actorEmail,
    action: 'task.reordered',
    entityType: 'Project',
    entityId: projectId,
    metadata: { status: input.status, count: input.orderedIds.length },
    ...meta,
  });

  return listTasks(workspaceId, projectId, { status: input.status });
}

export async function deleteTask(
  workspaceId: string,
  actorId: string,
  actorEmail: string,
  projectId: string,
  taskId: string,
  meta: RequestMeta,
): Promise<void> {
  await requireTask(workspaceId, projectId, taskId);
  await getPrisma().task.delete({ where: { id: taskId } });

  await recordAudit({
    workspaceId,
    actorId,
    actorEmail,
    action: 'task.deleted',
    entityType: 'Task',
    entityId: taskId,
    metadata: { projectId },
    ...meta,
  });
}
