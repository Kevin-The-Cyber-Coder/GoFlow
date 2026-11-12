import { and, eq } from 'drizzle-orm';

import type { Executor } from '../../db/client';
import { workspaceMembers } from '../../db/schema';

export interface Membership {
  workspaceId: string;
  role: string;
}

/**
 * Resolves the caller's membership. When `workspaceId` is omitted the first
 * membership (oldest workspace) is used, which is what a single-workspace user
 * expects without having to send a header.
 */
export async function findMembership(
  db: Executor,
  userId: string,
  workspaceId?: string,
): Promise<Membership | null> {
  const condition =
    workspaceId === undefined
      ? eq(workspaceMembers.userId, userId)
      : and(eq(workspaceMembers.userId, userId), eq(workspaceMembers.workspaceId, workspaceId));

  const rows = await db
    .select({ workspaceId: workspaceMembers.workspaceId, role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(condition)
    .orderBy(workspaceMembers.createdAt)
    .limit(1);

  return rows[0] ?? null;
}
