import { getPrisma } from '../../database/client';
import { ApiError } from '../../http/errors';
import { getProfile, type RequestContext } from '../auth/service';
import { auditData, recordAudit } from '../audit/service';
import { verifyPassword } from '../auth/password';
import type { UpdateProfileInput } from './schemas';

/**
 * Updates the caller's own profile. Returns the same shape as `GET /auth/me`
 * so a client can replace its cached profile with one response.
 */
export async function updateProfile(
  userId: string,
  input: UpdateProfileInput,
  context: RequestContext,
) {
  const prisma = getPrisma();
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: { id: true, email: true },
  });
  if (user === null) {
    throw ApiError.unauthorized('The account no longer exists.');
  }

  await prisma.user.update({
    where: { id: userId },
    data: {
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.avatarUrl === undefined ? {} : { avatarUrl: input.avatarUrl }),
      ...(input.locale === undefined ? {} : { locale: input.locale }),
      ...(input.timezone === undefined ? {} : { timezone: input.timezone }),
      ...(input.currency === undefined ? {} : { currency: input.currency }),
    },
  });

  await recordAudit({
    workspaceId: null,
    actorId: user.id,
    actorEmail: user.email,
    action: 'user.profile_updated',
    entityType: 'User',
    entityId: user.id,
    metadata: { fields: Object.keys(input) },
    ...context,
  });

  return getProfile(userId);
}

/**
 * Closes the caller's account.
 *
 * Financial records keep referencing the user (invoices, payments, time
 * entries), so this is a soft delete: e-mail and history survive for the
 * workspaces that still need them, the account can no longer authenticate, and
 * every refresh token is revoked. A sole owner of a workspace with other
 * members is blocked until ownership is transferred, otherwise those
 * teammates would be locked out of their own data.
 */
export async function closeAccount(
  userId: string,
  password: string,
  context: RequestContext,
): Promise<void> {
  const prisma = getPrisma();
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    include: {
      memberships: {
        where: { role: 'OWNER' },
        select: {
          workspaceId: true,
          workspace: {
            select: {
              name: true,
              deletedAt: true,
              _count: { select: { members: true } },
            },
          },
        },
      },
    },
  });
  if (user === null) {
    throw ApiError.unauthorized('The account no longer exists.');
  }

  const valid = await verifyPassword(user.passwordHash, password);
  if (!valid) {
    throw ApiError.badRequest('The password is incorrect.');
  }

  const sharedWorkspace = user.memberships.find(
    (membership) =>
      membership.workspace.deletedAt === null && membership.workspace._count.members > 1,
  );
  if (sharedWorkspace !== undefined) {
    throw ApiError.conflict(
      `Transfer ownership of "${sharedWorkspace.workspace.name}" to another member before closing your account.`,
      { workspaceId: sharedWorkspace.workspaceId },
    );
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: { deletedAt: new Date(), status: 'DISABLED' },
    }),
    prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
    prisma.auditLog.create({
      data: auditData({
        actorId: user.id,
        actorEmail: user.email,
        action: 'user.account_closed',
        entityType: 'User',
        entityId: user.id,
        metadata: { ownedWorkspaces: user.memberships.length },
        ...context,
      }),
    }),
  ]);
}
