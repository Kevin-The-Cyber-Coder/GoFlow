import { randomUUID } from 'node:crypto';

import { getPrisma } from '../database/client';

export interface TestUser {
  id: string;
  email: string;
}

export interface TestWorkspace {
  id: string;
  slug: string;
  ownerId: string;
}

export async function createTestUser(
  overrides: { email?: string; name?: string } = {},
): Promise<TestUser> {
  const email = overrides.email ?? `user-${randomUUID()}@example.test`;
  const user = await getPrisma().user.create({
    data: {
      email,
      name: overrides.name ?? 'Test User',
      passwordHash: '$2b$12$notarealhashusedonlyintestsnotarealhashusedonlyint',
    },
    select: { id: true, email: true },
  });
  return user;
}

export async function createTestWorkspace(
  ownerId: string,
  overrides: { name?: string; currency?: string; taxRateBps?: number } = {},
): Promise<TestWorkspace> {
  const slug = `ws-${randomUUID()}`;
  const workspace = await getPrisma().workspace.create({
    data: {
      name: overrides.name ?? 'Test Workspace',
      slug,
      ownerId,
      currency: overrides.currency ?? 'USD',
      defaultTaxRateBps: overrides.taxRateBps ?? 0,
      members: { create: { userId: ownerId, role: 'OWNER', acceptedAt: new Date() } },
    },
    select: { id: true, slug: true, ownerId: true },
  });
  return workspace;
}

export async function createTestClient(
  workspaceId: string,
  createdById: string,
  overrides: { name?: string; email?: string } = {},
): Promise<{ id: string; name: string }> {
  return getPrisma().client.create({
    data: {
      workspaceId,
      createdById,
      name: overrides.name ?? 'Acme Test Client',
      email: overrides.email ?? null,
      status: 'ACTIVE',
    },
    select: { id: true, name: true },
  });
}
