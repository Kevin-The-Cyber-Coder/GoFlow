import { randomUUID } from 'node:crypto';

import type { WorkspaceRole } from '@prisma/client';

import { getPrisma } from '../../database/client';
import { ApiError } from '../../http/errors';
import { auditData, recordAudit } from '../audit/service';
import { permissionMatrix } from './permissions';
import type { CreateWorkspaceInput, InviteMemberInput, UpdateWorkspaceInput } from './schemas';

export interface RequestMeta {
  readonly ip?: string | null;
  readonly userAgent?: string | null;
}

function slugFor(name: string): string {
  const base = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

  return `${base.length > 0 ? base : 'workspace'}-${randomUUID().slice(0, 8)}`;
}

export async function listWorkspaces(userId: string) {
  const memberships = await getPrisma().workspaceMember.findMany({
    where: { userId, workspace: { deletedAt: null } },
    include: {
      workspace: {
        select: {
          id: true,
          name: true,
          slug: true,
          currency: true,
          timezone: true,
          createdAt: true,
          _count: { select: { members: true } },
        },
      },
    },
    orderBy: { invitedAt: 'asc' },
  });

  return memberships.map((membership) => ({
    ...membership.workspace,
    role: membership.role,
    memberCount: membership.workspace._count.members,
  }));
}

export async function createWorkspace(
  userId: string,
  actorEmail: string,
  input: CreateWorkspaceInput,
  meta: RequestMeta,
) {
  const prisma = getPrisma();

  const workspace = await prisma.$transaction(async (tx) => {
    const created = await tx.workspace.create({
      data: {
        name: input.name,
        slug: slugFor(input.name),
        ownerId: userId,
        currency: input.currency ?? 'USD',
        timezone: input.timezone ?? 'UTC',
      },
    });

    await tx.workspaceMember.create({
      data: { workspaceId: created.id, userId, role: 'OWNER', acceptedAt: new Date() },
    });

    await tx.auditLog.create({
      data: auditData({
        workspaceId: created.id,
        actorId: userId,
        actorEmail,
        action: 'workspace.created',
        entityType: 'Workspace',
        entityId: created.id,
        ...meta,
      }),
    });

    return created;
  });

  return workspace;
}

export async function getWorkspace(workspaceId: string) {
  const workspace = await getPrisma().workspace.findFirst({
    where: { id: workspaceId, deletedAt: null },
    include: {
      _count: { select: { members: true, clients: true, projects: true, invoices: true } },
    },
  });

  if (workspace === null) {
    throw ApiError.notFound('Workspace');
  }

  return {
    id: workspace.id,
    name: workspace.name,
    slug: workspace.slug,
    currency: workspace.currency,
    timezone: workspace.timezone,
    invoicePrefix: workspace.invoicePrefix,
    defaultTaxRateBps: workspace.defaultTaxRateBps,
    createdAt: workspace.createdAt,
    counts: {
      members: workspace._count.members,
      clients: workspace._count.clients,
      projects: workspace._count.projects,
      invoices: workspace._count.invoices,
    },
  };
}

export async function updateWorkspace(
  workspaceId: string,
  actorId: string,
  actorEmail: string,
  input: UpdateWorkspaceInput,
  meta: RequestMeta,
) {
  const prisma = getPrisma();
  const updated = await prisma.workspace.update({
    where: { id: workspaceId },
    data: {
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.currency === undefined ? {} : { currency: input.currency }),
      ...(input.timezone === undefined ? {} : { timezone: input.timezone }),
      ...(input.invoicePrefix === undefined ? {} : { invoicePrefix: input.invoicePrefix }),
      ...(input.defaultTaxRateBps === undefined
        ? {}
        : { defaultTaxRateBps: input.defaultTaxRateBps }),
    },
  });

  await recordAudit({
    workspaceId,
    actorId,
    actorEmail,
    action: 'workspace.updated',
    entityType: 'Workspace',
    entityId: workspaceId,
    metadata: { fields: Object.keys(input) },
    ...meta,
  });

  return updated;
}

export async function listMembers(workspaceId: string) {
  const members = await getPrisma().workspaceMember.findMany({
    where: { workspaceId },
    include: { user: { select: { id: true, name: true, email: true, avatarUrl: true } } },
    orderBy: [{ role: 'asc' }, { invitedAt: 'asc' }],
  });

  return members.map((member) => ({
    id: member.id,
    userId: member.user.id,
    name: member.user.name,
    email: member.user.email,
    avatarUrl: member.user.avatarUrl,
    role: member.role,
    invitedAt: member.invitedAt,
    acceptedAt: member.acceptedAt,
  }));
}

export async function inviteMember(
  workspaceId: string,
  actorId: string,
  actorEmail: string,
  input: InviteMemberInput,
  meta: RequestMeta,
) {
  const prisma = getPrisma();
  const user = await prisma.user.findFirst({
    where: { email: input.email, deletedAt: null },
    select: { id: true },
  });

  // Invitations are matched to existing accounts until the e-mail transport
  // can send an accept link; returning a clear error beats a silent no-op.
  if (user === null) {
    throw new ApiError(
      422,
      'INVITEE_NOT_FOUND',
      'No GoFlow account uses that e-mail address yet. Ask them to register first.',
    );
  }

  const existing = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId: user.id } },
  });
  if (existing !== null) {
    throw ApiError.conflict('That person is already a member of this workspace.');
  }

  const member = await prisma.workspaceMember.create({
    data: {
      workspaceId,
      userId: user.id,
      role: input.role as WorkspaceRole,
      invitedById: actorId,
    },
  });

  await recordAudit({
    workspaceId,
    actorId,
    actorEmail,
    action: 'member.invited',
    entityType: 'WorkspaceMember',
    entityId: member.id,
    metadata: { role: input.role, inviteeEmail: input.email },
    ...meta,
  });

  return member;
}

export async function updateMemberRole(
  workspaceId: string,
  actorId: string,
  actorEmail: string,
  memberId: string,
  role: WorkspaceRole,
  meta: RequestMeta,
) {
  const prisma = getPrisma();
  const member = await prisma.workspaceMember.findFirst({
    where: { id: memberId, workspaceId },
  });

  if (member === null) {
    throw ApiError.notFound('Team member');
  }
  if (member.role === 'OWNER') {
    throw ApiError.badRequest('Ownership is transferred explicitly, not by changing a role.');
  }
  if (member.userId === actorId) {
    throw ApiError.badRequest('You cannot change your own role.');
  }
  if (role === 'OWNER') {
    throw ApiError.badRequest('Use the ownership transfer endpoint to assign the OWNER role.');
  }

  const updated = await prisma.workspaceMember.update({
    where: { id: memberId },
    data: { role },
  });

  await recordAudit({
    workspaceId,
    actorId,
    actorEmail,
    action: 'member.role_changed',
    entityType: 'WorkspaceMember',
    entityId: memberId,
    metadata: { from: member.role, to: role },
    ...meta,
  });

  return updated;
}

export async function removeMember(
  workspaceId: string,
  actorId: string,
  actorEmail: string,
  memberId: string,
  meta: RequestMeta,
) {
  const prisma = getPrisma();
  const member = await prisma.workspaceMember.findFirst({
    where: { id: memberId, workspaceId },
  });

  if (member === null) {
    throw ApiError.notFound('Team member');
  }
  if (member.role === 'OWNER') {
    throw ApiError.badRequest('The workspace owner cannot be removed. Transfer ownership first.');
  }

  await prisma.workspaceMember.delete({ where: { id: memberId } });

  await recordAudit({
    workspaceId,
    actorId,
    actorEmail,
    action: 'member.removed',
    entityType: 'WorkspaceMember',
    entityId: memberId,
    metadata: { userId: member.userId },
    ...meta,
  });
}

export async function transferOwnership(
  workspaceId: string,
  actorId: string,
  actorEmail: string,
  newOwnerUserId: string,
  meta: RequestMeta,
): Promise<void> {
  const prisma = getPrisma();
  const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId } });
  if (workspace === null) {
    throw ApiError.notFound('Workspace');
  }
  if (workspace.ownerId !== actorId) {
    throw ApiError.forbidden('Only the current owner can transfer ownership.');
  }
  if (newOwnerUserId === actorId) {
    throw ApiError.badRequest('You already own this workspace.');
  }

  const target = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId: newOwnerUserId } },
  });
  if (target === null) {
    throw ApiError.notFound('Team member');
  }

  await prisma.$transaction([
    prisma.workspace.update({ where: { id: workspaceId }, data: { ownerId: newOwnerUserId } }),
    prisma.workspaceMember.update({
      where: { id: target.id },
      data: { role: 'OWNER', acceptedAt: target.acceptedAt ?? new Date() },
    }),
    prisma.workspaceMember.updateMany({
      where: { workspaceId, userId: actorId },
      data: { role: 'ADMIN' },
    }),
    prisma.auditLog.create({
      data: auditData({
        workspaceId,
        actorId,
        actorEmail,
        action: 'workspace.ownership_transferred',
        entityType: 'Workspace',
        entityId: workspaceId,
        metadata: { fromUserId: actorId, toUserId: newOwnerUserId },
        ...meta,
      }),
    }),
  ]);
}

export function roles(): ReturnType<typeof permissionMatrix> {
  return permissionMatrix();
}
