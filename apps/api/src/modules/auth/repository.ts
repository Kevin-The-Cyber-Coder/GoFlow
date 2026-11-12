import { and, eq, isNull, sql } from 'drizzle-orm';

import type { Executor } from '../../db/client';
import {
  refreshTokens,
  users,
  workspaceMembers,
  workspaces,
  type RefreshToken,
  type User,
  type Workspace,
} from '../../db/schema';

export interface InsertUserInput {
  email: string;
  passwordHash: string;
  name: string;
}

export interface MembershipSummary {
  workspace: Workspace;
  role: string;
}

export async function findUserByEmail(db: Executor, email: string): Promise<User | null> {
  const rows = await db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = ${email}`)
    .limit(1);

  return rows[0] ?? null;
}

export async function findUserById(db: Executor, userId: string): Promise<User | null> {
  const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  return rows[0] ?? null;
}

export async function insertUser(db: Executor, input: InsertUserInput): Promise<User> {
  const [row] = await db
    .insert(users)
    .values({
      email: input.email,
      passwordHash: input.passwordHash,
      name: input.name,
    })
    .returning();

  if (!row) {
    throw new Error('Insert into users returned no row.');
  }

  return row;
}

/**
 * Creates the user's first workspace and makes them its owner. Both rows must
 * exist together, so this is only valid inside a transaction.
 */
export async function createWorkspaceForOwner(
  db: Executor,
  input: { ownerId: string; name: string; slug: string },
): Promise<Workspace> {
  const [workspace] = await db
    .insert(workspaces)
    .values({
      name: input.name,
      slug: input.slug,
      ownerId: input.ownerId,
    })
    .returning();

  if (!workspace) {
    throw new Error('Insert into workspaces returned no row.');
  }

  await db.insert(workspaceMembers).values({
    workspaceId: workspace.id,
    userId: input.ownerId,
    role: 'owner',
  });

  return workspace;
}

export async function findMemberships(db: Executor, userId: string): Promise<MembershipSummary[]> {
  return db
    .select({ workspace: workspaces, role: workspaceMembers.role })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(eq(workspaceMembers.userId, userId))
    .orderBy(workspaces.createdAt);
}

export interface InsertRefreshTokenInput {
  userId: string;
  familyId: string;
  tokenHash: string;
  expiresAt: Date;
  userAgent?: string | undefined;
  ipAddress?: string | undefined;
}

export async function insertRefreshToken(
  db: Executor,
  input: InsertRefreshTokenInput,
): Promise<RefreshToken> {
  const [row] = await db
    .insert(refreshTokens)
    .values({
      userId: input.userId,
      familyId: input.familyId,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
      userAgent: input.userAgent ?? null,
      ipAddress: input.ipAddress ?? null,
    })
    .returning();

  if (!row) {
    throw new Error('Insert into refresh_tokens returned no row.');
  }

  return row;
}

export async function findRefreshTokenByHash(
  db: Executor,
  tokenHash: string,
): Promise<RefreshToken | null> {
  const rows = await db
    .select()
    .from(refreshTokens)
    .where(eq(refreshTokens.tokenHash, tokenHash))
    .limit(1);

  return rows[0] ?? null;
}

/**
 * Atomically marks a token as used. Returns false when another request already
 * consumed it, which is how concurrent refreshes are detected without locking
 * the whole session table.
 */
export async function claimRefreshToken(
  db: Executor,
  tokenId: string,
  replacedByTokenId: string,
): Promise<boolean> {
  const rows = await db
    .update(refreshTokens)
    .set({ revokedAt: new Date(), replacedByTokenId })
    .where(and(eq(refreshTokens.id, tokenId), isNull(refreshTokens.revokedAt)))
    .returning({ id: refreshTokens.id });

  return rows.length > 0;
}

export async function revokeRefreshToken(db: Executor, tokenId: string): Promise<void> {
  await db
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(refreshTokens.id, tokenId), isNull(refreshTokens.revokedAt)));
}

export async function revokeTokenFamily(db: Executor, familyId: string): Promise<void> {
  await db
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)));
}
