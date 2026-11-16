import type { ExpenseStatus, Prisma, WorkspaceRole } from '@prisma/client';

import { getPrisma } from '../../database/client';
import { ApiError } from '../../http/errors';
import { money, pageMeta, toPagination } from '../../http/pagination';
import { auditData } from '../audit/service';
import type { RequestMeta } from '../clients/service';
import { can } from '../workspaces/permissions';
import type {
  CreateCategoryInput,
  CreateExpenseInput,
  ListExpensesQuery,
  ReviewExpenseInput,
  UpdateExpenseInput,
} from './schemas';

function utcDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function expenseInclude() {
  return {
    category: { select: { id: true, name: true, color: true } },
  } satisfies Prisma.ExpenseInclude;
}

type ExpenseRow = Prisma.ExpenseGetPayload<{ include: ReturnType<typeof expenseInclude> }>;

function expenseDto(expense: ExpenseRow) {
  return {
    id: expense.id,
    description: expense.description,
    amountMinor: money(expense.amountMinor),
    currency: expense.currency,
    date: isoDate(expense.date),
    method: expense.method,
    vendor: expense.vendor,
    notes: expense.notes,
    status: expense.status,
    recurring: expense.recurring,
    category: expense.category,
    projectId: expense.projectId,
    clientId: expense.clientId,
    createdById: expense.createdById,
    createdAt: expense.createdAt.toISOString(),
    updatedAt: expense.updatedAt.toISOString(),
  };
}

function categoryDto(category: { id: string; name: string; color: string; createdAt: Date }) {
  return {
    id: category.id,
    name: category.name,
    color: category.color,
    createdAt: category.createdAt.toISOString(),
  };
}

/** A category must exist in the same workspace; a foreign id is a 404. */
async function assertCategory(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  categoryId: string,
): Promise<void> {
  const category = await tx.expenseCategory.findFirst({
    where: { id: categoryId, workspaceId },
    select: { id: true },
  });
  if (category === null) {
    throw ApiError.notFound('Expense category');
  }
}

/**
 * Returns the project's client so the caller can reject an expense that names
 * a project and a different client: that combination would make reporting
 * attribute the same money to two places.
 */
async function projectClient(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  projectId: string,
): Promise<string> {
  const project = await tx.project.findFirst({
    where: { id: projectId, workspaceId },
    select: { clientId: true },
  });
  if (project === null) {
    throw ApiError.notFound('Project');
  }
  return project.clientId;
}

async function assertClient(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  clientId: string,
): Promise<void> {
  const client = await tx.client.findFirst({
    where: { id: clientId, workspaceId, deletedAt: null },
    select: { id: true },
  });
  if (client === null) {
    throw ApiError.notFound('Client');
  }
}

async function assertLinks(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  input: { categoryId?: string | null; projectId?: string | null; clientId?: string | null },
): Promise<void> {
  if (typeof input.categoryId === 'string') {
    await assertCategory(tx, workspaceId, input.categoryId);
  }
  if (typeof input.clientId === 'string') {
    await assertClient(tx, workspaceId, input.clientId);
  }
  if (typeof input.projectId === 'string') {
    const clientId = await projectClient(tx, workspaceId, input.projectId);
    if (typeof input.clientId === 'string' && input.clientId !== clientId) {
      throw ApiError.badRequest('The project belongs to a different client.', [
        { path: 'projectId', message: 'The project belongs to a different client.' },
      ]);
    }
  }
}

export async function listCategories(workspaceId: string) {
  const rows = await getPrisma().expenseCategory.findMany({
    where: { workspaceId },
    orderBy: { name: 'asc' },
  });
  return { categories: rows.map(categoryDto) };
}

export async function createCategory(
  workspaceId: string,
  actorId: string,
  actorEmail: string,
  input: CreateCategoryInput,
  meta: RequestMeta,
) {
  try {
    return await getPrisma().$transaction(async (tx) => {
      const category = await tx.expenseCategory.create({
        data: {
          workspaceId,
          name: input.name,
          ...(input.color === undefined ? {} : { color: input.color }),
        },
      });

      await tx.auditLog.create({
        data: auditData({
          workspaceId,
          actorId,
          actorEmail,
          action: 'expense_category.created',
          entityType: 'ExpenseCategory',
          entityId: category.id,
          metadata: { name: category.name },
          ...meta,
        }),
      });

      return categoryDto(category);
    });
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      (error as { code?: unknown }).code === 'P2002'
    ) {
      throw ApiError.conflict('A category with that name already exists.');
    }
    throw error;
  }
}

export async function createExpense(
  workspaceId: string,
  role: WorkspaceRole,
  actorId: string,
  actorEmail: string,
  input: CreateExpenseInput,
  meta: RequestMeta,
) {
  const canApprove = can(role, 'expenses:approve');
  if (input.status !== undefined && input.status !== 'SUBMITTED' && !canApprove) {
    throw ApiError.forbidden('Your role cannot set an expense status other than SUBMITTED.');
  }

  return getPrisma().$transaction(async (tx) => {
    await assertLinks(tx, workspaceId, input);

    const workspace = await tx.workspace.findUniqueOrThrow({
      where: { id: workspaceId },
      select: { currency: true },
    });

    // The schema default is APPROVED for a single-person workspace, but an
    // employee's expense should reach the books only after review.
    const status: ExpenseStatus = input.status ?? (canApprove ? 'APPROVED' : 'SUBMITTED');

    const expense = await tx.expense.create({
      data: {
        workspaceId,
        description: input.description,
        amountMinor: BigInt(input.amountMinor),
        currency: input.currency ?? workspace.currency,
        date: utcDate(input.date),
        status,
        ...(input.method === undefined ? {} : { method: input.method }),
        ...(input.vendor === undefined ? {} : { vendor: input.vendor }),
        ...(input.notes === undefined ? {} : { notes: input.notes }),
        ...(input.categoryId === undefined ? {} : { categoryId: input.categoryId }),
        ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
        ...(input.clientId === undefined ? {} : { clientId: input.clientId }),
        ...(input.recurring === undefined ? {} : { recurring: input.recurring }),
        createdById: actorId,
      },
      include: expenseInclude(),
    });

    await tx.auditLog.create({
      data: auditData({
        workspaceId,
        actorId,
        actorEmail,
        action: 'expense.created',
        entityType: 'Expense',
        entityId: expense.id,
        metadata: {
          description: expense.description,
          amountMinor: expense.amountMinor.toString(),
          status: expense.status,
        },
        ...meta,
      }),
    });

    return expenseDto(expense);
  });
}

export async function listExpenses(workspaceId: string, query: ListExpensesQuery) {
  const pagination = toPagination(query);

  const date: Prisma.DateTimeFilter = {};
  if (query.from !== undefined) {
    date.gte = utcDate(query.from);
  }
  if (query.to !== undefined) {
    // A date-only `to` must include the whole UTC day.
    date.lte = new Date(`${query.to}T23:59:59.999Z`);
  }

  const where: Prisma.ExpenseWhereInput = {
    workspaceId,
    ...(query.categoryId === undefined ? {} : { categoryId: query.categoryId }),
    ...(query.projectId === undefined ? {} : { projectId: query.projectId }),
    ...(query.clientId === undefined ? {} : { clientId: query.clientId }),
    ...(query.status === undefined ? {} : { status: query.status }),
    ...(Object.keys(date).length === 0 ? {} : { date }),
    ...(query.search === undefined
      ? {}
      : {
          OR: [
            { description: { contains: query.search, mode: 'insensitive' } },
            { vendor: { contains: query.search, mode: 'insensitive' } },
          ],
        }),
  };

  const [total, rows] = await Promise.all([
    getPrisma().expense.count({ where }),
    getPrisma().expense.findMany({
      where,
      include: expenseInclude(),
      // `id` breaks ties so two expenses recorded on the same day cannot swap
      // places between pages.
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      skip: pagination.skip,
      take: pagination.take,
    }),
  ]);

  return { data: rows.map(expenseDto), meta: pageMeta(total, pagination) };
}

export async function getExpense(workspaceId: string, expenseId: string) {
  const expense = await getPrisma().expense.findFirst({
    where: { id: expenseId, workspaceId },
    include: expenseInclude(),
  });
  if (expense === null) {
    throw ApiError.notFound('Expense');
  }
  return expenseDto(expense);
}

export async function updateExpense(
  workspaceId: string,
  role: WorkspaceRole,
  actorId: string,
  actorEmail: string,
  expenseId: string,
  input: UpdateExpenseInput,
  meta: RequestMeta,
) {
  return getPrisma().$transaction(async (tx) => {
    const existing = await tx.expense.findFirst({
      where: { id: expenseId, workspaceId },
      select: { id: true, createdById: true },
    });
    if (existing === null) {
      throw ApiError.notFound('Expense');
    }
    // Editing someone else's expense is a review action, not a write action.
    if (existing.createdById !== actorId && !can(role, 'expenses:approve')) {
      throw ApiError.forbidden('You can only edit expenses you recorded.');
    }

    await assertLinks(tx, workspaceId, input);

    const expense = await tx.expense.update({
      where: { id: existing.id },
      data: {
        ...(input.description === undefined ? {} : { description: input.description }),
        ...(input.amountMinor === undefined ? {} : { amountMinor: BigInt(input.amountMinor) }),
        ...(input.currency === undefined ? {} : { currency: input.currency }),
        ...(input.date === undefined ? {} : { date: utcDate(input.date) }),
        ...(input.method === undefined ? {} : { method: input.method }),
        ...(input.vendor === undefined ? {} : { vendor: input.vendor }),
        ...(input.notes === undefined ? {} : { notes: input.notes }),
        ...(input.categoryId === undefined ? {} : { categoryId: input.categoryId }),
        ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
        ...(input.clientId === undefined ? {} : { clientId: input.clientId }),
        ...(input.recurring === undefined ? {} : { recurring: input.recurring }),
      },
      include: expenseInclude(),
    });

    await tx.auditLog.create({
      data: auditData({
        workspaceId,
        actorId,
        actorEmail,
        action: 'expense.updated',
        entityType: 'Expense',
        entityId: expense.id,
        metadata: {
          changed: Object.keys(input),
          amountMinor: expense.amountMinor.toString(),
        },
        ...meta,
      }),
    });

    return expenseDto(expense);
  });
}

export async function reviewExpense(
  workspaceId: string,
  actorId: string,
  actorEmail: string,
  expenseId: string,
  input: ReviewExpenseInput,
  meta: RequestMeta,
) {
  return getPrisma().$transaction(async (tx) => {
    const existing = await tx.expense.findFirst({
      where: { id: expenseId, workspaceId },
      select: { id: true, status: true },
    });
    if (existing === null) {
      throw ApiError.notFound('Expense');
    }
    if (existing.status === input.status) {
      throw ApiError.conflict(`This expense is already ${input.status.toLowerCase()}.`);
    }

    const expense = await tx.expense.update({
      where: { id: existing.id },
      data: { status: input.status },
      include: expenseInclude(),
    });

    await tx.auditLog.create({
      data: auditData({
        workspaceId,
        actorId,
        actorEmail,
        action: input.status === 'APPROVED' ? 'expense.approved' : 'expense.rejected',
        entityType: 'Expense',
        entityId: expense.id,
        metadata: {
          from: existing.status,
          to: input.status,
          ...(input.note === undefined ? {} : { note: input.note }),
        },
        ...meta,
      }),
    });

    return expenseDto(expense);
  });
}

export async function deleteExpense(
  workspaceId: string,
  role: WorkspaceRole,
  actorId: string,
  actorEmail: string,
  expenseId: string,
  meta: RequestMeta,
): Promise<void> {
  await getPrisma().$transaction(async (tx) => {
    const existing = await tx.expense.findFirst({
      where: { id: expenseId, workspaceId },
      select: { id: true, createdById: true, description: true, amountMinor: true },
    });
    if (existing === null) {
      throw ApiError.notFound('Expense');
    }
    if (existing.createdById !== actorId && !can(role, 'expenses:approve')) {
      throw ApiError.forbidden('You can only delete expenses you recorded.');
    }

    await tx.expense.delete({ where: { id: existing.id } });

    await tx.auditLog.create({
      data: auditData({
        workspaceId,
        actorId,
        actorEmail,
        action: 'expense.deleted',
        entityType: 'Expense',
        entityId: existing.id,
        metadata: {
          description: existing.description,
          amountMinor: existing.amountMinor.toString(),
        },
        ...meta,
      }),
    });
  });
}
