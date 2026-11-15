import type { AuditLog, Prisma } from '@prisma/client';

import { getPrisma } from '../../database/client';
import { pageMeta, toPagination } from '../../http/pagination';
import type { ListAuditQuery } from './schemas';

export interface AuditInput {
  readonly workspaceId?: string | null;
  readonly actorId?: string | null;
  readonly actorEmail?: string | null;
  readonly action: string;
  readonly entityType: string;
  readonly entityId?: string | null;
  readonly metadata?: Prisma.InputJsonValue;
  readonly ip?: string | null;
  readonly userAgent?: string | null;
}

/** Builds the row so callers can include it in a larger transaction. */
export function auditData(input: AuditInput): Prisma.AuditLogUncheckedCreateInput {
  return {
    workspaceId: input.workspaceId ?? null,
    actorId: input.actorId ?? null,
    actorEmail: input.actorEmail ?? null,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    metadata: input.metadata,
    ip: input.ip ?? null,
    userAgent: input.userAgent ?? null,
  };
}

/**
 * Writes an audit entry outside of a surrounding transaction.
 *
 * Auditing must never take down the operation it records, so failures are
 * logged and swallowed. Operations that must be atomic with their audit entry
 * (payments, reversals) write the row inside their own transaction instead.
 */
export async function recordAudit(input: AuditInput): Promise<void> {
  try {
    await getPrisma().auditLog.create({ data: auditData(input) });
  } catch (error) {
    console.error('[audit] failed to persist audit entry', { action: input.action, error });
  }
}

/**
 * Serialises a row for the API. `metadata` stays as the JSON the writer chose,
 * because the useful detail differs per entity (client name, changed fields,
 * invoice number) and flattening it here would lose that.
 */
function toAuditDto(entry: AuditLog) {
  return {
    id: entry.id,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    actorId: entry.actorId,
    actorEmail: entry.actorEmail,
    metadata: entry.metadata ?? null,
    ip: entry.ip,
    userAgent: entry.userAgent,
    createdAt: entry.createdAt.toISOString(),
  };
}

/**
 * Reads the workspace trail.
 *
 * Only entries carrying the resolved workspace id are returned. Events that
 * belong to a user rather than a workspace (a failed login, for example) are
 * written with a null `workspaceId` and deliberately do not appear in any
 * workspace's history.
 */
export async function listAuditEntries(workspaceId: string, query: ListAuditQuery) {
  const prisma = getPrisma();
  const pagination = toPagination(query);

  const createdAt: Prisma.DateTimeFilter = {};
  if (query.from !== undefined) {
    createdAt.gte = new Date(`${query.from}T00:00:00.000Z`);
  }
  if (query.to !== undefined) {
    // Dates are calendar dates at UTC midnight, so an inclusive `to` has to
    // cover the whole day rather than only its first millisecond.
    createdAt.lte = new Date(`${query.to}T23:59:59.999Z`);
  }

  const where: Prisma.AuditLogWhereInput = {
    workspaceId,
    ...(query.action === undefined ? {} : { action: query.action }),
    ...(query.entityType === undefined ? {} : { entityType: query.entityType }),
    ...(query.entityId === undefined ? {} : { entityId: query.entityId }),
    ...(query.actorId === undefined ? {} : { actorId: query.actorId }),
    ...(Object.keys(createdAt).length === 0 ? {} : { createdAt }),
    ...(query.search === undefined
      ? {}
      : {
          OR: [
            { action: { contains: query.search, mode: 'insensitive' } },
            { entityType: { contains: query.search, mode: 'insensitive' } },
            { actorEmail: { contains: query.search, mode: 'insensitive' } },
          ],
        }),
  };

  const [total, rows] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      // `id` breaks ties so two entries written in the same millisecond cannot
      // swap places between pages and be returned twice or skipped.
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: pagination.skip,
      take: pagination.take,
    }),
  ]);

  return { entries: rows.map(toAuditDto), meta: pageMeta(total, pagination) };
}
