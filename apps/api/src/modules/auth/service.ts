import { randomUUID } from 'node:crypto';

import { Prisma, type User } from '@prisma/client';

import { loadAuthConfig } from '../../config/auth';
import { getPrisma } from '../../database/client';
import { ApiError } from '../../http/errors';
import { auditData, recordAudit } from '../audit/service';
import { hashPassword, verifyPassword } from './password';
import type { LoginInput, RegisterInput } from './schemas';
import { createRefreshToken, hashRefreshToken, signAccessToken } from './tokens';

export interface RequestContext {
  readonly ip?: string | null;
  readonly userAgent?: string | null;
}

export interface TokenPair {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresIn: number;
}

export interface UserDto {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly avatarUrl: string | null;
  readonly locale: string;
  readonly timezone: string;
  readonly currency: string;
  readonly status: string;
  readonly emailVerifiedAt: Date | null;
  readonly createdAt: Date;
}

export interface MembershipDto {
  readonly workspaceId: string;
  readonly workspaceName: string;
  readonly workspaceSlug: string;
  readonly role: string;
}

function toUserDto(user: User): UserDto {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    locale: user.locale,
    timezone: user.timezone,
    currency: user.currency,
    status: user.status,
    emailVerifiedAt: user.emailVerifiedAt,
    createdAt: user.createdAt,
  };
}

function slugify(input: string): string {
  const base = input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

  return `${base.length > 0 ? base : 'workspace'}-${randomUUID().slice(0, 8)}`;
}

function refreshExpiry(config: ReturnType<typeof loadAuthConfig>): Date {
  return new Date(Date.now() + config.refreshTtlDays * 24 * 60 * 60 * 1000);
}

async function issueSession(
  user: Pick<User, 'id' | 'email'>,
  context: RequestContext,
  familyId = randomUUID(),
): Promise<TokenPair> {
  const config = loadAuthConfig();
  const { token, tokenHash } = createRefreshToken();

  await getPrisma().refreshToken.create({
    data: {
      userId: user.id,
      tokenHash,
      familyId,
      expiresAt: refreshExpiry(config),
      ip: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    },
  });

  return {
    accessToken: signAccessToken({ userId: user.id, email: user.email }, config),
    refreshToken: token,
    expiresIn: config.accessTtlSeconds,
  };
}

export async function register(
  input: RegisterInput,
  context: RequestContext,
): Promise<{ user: UserDto; workspace: MembershipDto; tokens: TokenPair }> {
  const prisma = getPrisma();
  const passwordHash = await hashPassword(input.password);
  const workspaceName = input.businessName ?? `${input.name}'s workspace`;

  // E-mail verification is sent by the notifications module; until a mail
  // transport is configured the account is usable immediately and
  // `emailVerifiedAt` stays null as an explicit marker.
  try {
    const created = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: input.email,
          passwordHash,
          name: input.name,
          currency: input.currency ?? 'USD',
          timezone: input.timezone ?? 'UTC',
        },
      });

      const workspace = await tx.workspace.create({
        data: {
          name: workspaceName,
          slug: slugify(workspaceName),
          ownerId: user.id,
          currency: input.currency ?? 'USD',
          timezone: input.timezone ?? 'UTC',
        },
      });

      await tx.workspaceMember.create({
        data: { workspaceId: workspace.id, userId: user.id, role: 'OWNER', acceptedAt: new Date() },
      });

      await tx.auditLog.create({
        data: auditData({
          workspaceId: workspace.id,
          actorId: user.id,
          actorEmail: user.email,
          action: 'auth.registered',
          entityType: 'User',
          entityId: user.id,
          ...context,
        }),
      });

      return { user, workspace };
    });

    const tokens = await issueSession(created.user, context);

    return {
      user: toUserDto(created.user),
      workspace: {
        workspaceId: created.workspace.id,
        workspaceName: created.workspace.name,
        workspaceSlug: created.workspace.slug,
        role: 'OWNER',
      },
      tokens,
    };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw ApiError.conflict('An account with this e-mail address already exists.');
    }
    throw error;
  }
}

export async function login(input: LoginInput, context: RequestContext): Promise<TokenPair> {
  const prisma = getPrisma();
  const user = await prisma.user.findUnique({ where: { email: input.email } });

  // Identical response for unknown e-mail and wrong password: disclosing
  // which one is wrong turns this endpoint into an account enumeration oracle.
  const invalid = ApiError.unauthorized('Invalid e-mail address or password.');
  if (user === null || user.deletedAt !== null) {
    throw invalid;
  }
  if (user.status !== 'ACTIVE') {
    throw ApiError.forbidden('This account is not active.');
  }

  const valid = await verifyPassword(user.passwordHash, input.password);
  if (!valid) {
    await recordAudit({
      actorId: user.id,
      actorEmail: user.email,
      action: 'auth.login_failed',
      entityType: 'User',
      entityId: user.id,
      ...context,
    });
    throw invalid;
  }

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await recordAudit({
    actorId: user.id,
    actorEmail: user.email,
    action: 'auth.login_succeeded',
    entityType: 'User',
    entityId: user.id,
    ...context,
  });

  return issueSession(user, context);
}

export async function refreshSession(
  rawToken: string,
  context: RequestContext,
): Promise<TokenPair> {
  const prisma = getPrisma();
  const tokenHash = hashRefreshToken(rawToken);
  const existing = await prisma.refreshToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (existing === null) {
    throw ApiError.unauthorized('The refresh token is invalid.');
  }

  // A rotated token must never be usable again. If one is replayed, assume the
  // token was stolen and revoke the whole family so neither party keeps a
  // valid session.
  if (existing.revokedAt !== null || existing.replacedByTokenId !== null) {
    await prisma.refreshToken.updateMany({
      where: { familyId: existing.familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await recordAudit({
      actorId: existing.userId,
      actorEmail: existing.user.email,
      action: 'auth.refresh_reuse_detected',
      entityType: 'RefreshToken',
      entityId: existing.id,
      metadata: { familyId: existing.familyId },
      ...context,
    });
    throw ApiError.unauthorized('This refresh token has already been used.');
  }

  if (existing.expiresAt.getTime() <= Date.now()) {
    throw ApiError.unauthorized('The refresh token has expired.');
  }

  if (existing.user.status !== 'ACTIVE' || existing.user.deletedAt !== null) {
    throw ApiError.forbidden('This account is not active.');
  }

  const config = loadAuthConfig();
  const next = createRefreshToken();
  const nextId = randomUUID();
  const now = new Date();

  await prisma.$transaction([
    prisma.refreshToken.create({
      data: {
        id: nextId,
        userId: existing.userId,
        tokenHash: next.tokenHash,
        familyId: existing.familyId,
        expiresAt: refreshExpiry(config),
        ip: context.ip ?? null,
        userAgent: context.userAgent ?? null,
      },
    }),
    prisma.refreshToken.update({
      where: { id: existing.id },
      data: { revokedAt: now, replacedByTokenId: nextId },
    }),
  ]);

  return {
    accessToken: signAccessToken({ userId: existing.userId, email: existing.user.email }, config),
    refreshToken: next.token,
    expiresIn: config.accessTtlSeconds,
  };
}

export async function logout(rawToken: string): Promise<void> {
  await getPrisma().refreshToken.updateMany({
    where: { tokenHash: hashRefreshToken(rawToken), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function logoutAll(userId: string): Promise<number> {
  const result = await getPrisma().refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count;
}

export async function getProfile(
  userId: string,
): Promise<{ user: UserDto; memberships: MembershipDto[] }> {
  const user = await getPrisma().user.findFirst({
    where: { id: userId, deletedAt: null },
    include: {
      memberships: { include: { workspace: true }, orderBy: { invitedAt: 'asc' } },
    },
  });

  if (user === null) {
    throw ApiError.unauthorized('The account no longer exists.');
  }

  return {
    user: toUserDto(user),
    memberships: user.memberships.map((member) => ({
      workspaceId: member.workspaceId,
      workspaceName: member.workspace.name,
      workspaceSlug: member.workspace.slug,
      role: member.role,
    })),
  };
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
  context: RequestContext,
): Promise<void> {
  const prisma = getPrisma();
  const user = await prisma.user.findFirst({ where: { id: userId, deletedAt: null } });
  if (user === null) {
    throw ApiError.unauthorized('The account no longer exists.');
  }

  const valid = await verifyPassword(user.passwordHash, currentPassword);
  if (!valid) {
    throw ApiError.badRequest('The current password is incorrect.');
  }

  const passwordHash = await hashPassword(newPassword);
  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { passwordHash } }),
    // A password change invalidates every existing session; the client must
    // sign in again on each device.
    prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
    prisma.auditLog.create({
      data: auditData({
        actorId: user.id,
        actorEmail: user.email,
        action: 'auth.password_changed',
        entityType: 'User',
        entityId: user.id,
        ...context,
      }),
    }),
  ]);
}

export async function listSessions(userId: string): Promise<
  Array<{
    id: string;
    ip: string | null;
    userAgent: string | null;
    createdAt: Date;
    expiresAt: Date;
  }>
> {
  return getPrisma().refreshToken.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    select: { id: true, ip: true, userAgent: true, createdAt: true, expiresAt: true },
    orderBy: { createdAt: 'desc' },
  });
}

export async function revokeSession(userId: string, sessionId: string): Promise<void> {
  const result = await getPrisma().refreshToken.updateMany({
    where: { id: sessionId, userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  if (result.count === 0) {
    throw ApiError.notFound('Session');
  }
}
