import type { Prisma } from '@prisma/client';

import { getPrisma } from '../../database/client';

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
