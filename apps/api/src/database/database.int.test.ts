import { getPrisma } from '../database/client';
import { resetDatabase } from '../test-utils/db';
import { createTestClient, createTestUser, createTestWorkspace } from '../test-utils/factories';

jest.setTimeout(30_000);

describe('database foundation', () => {
  const prisma = getPrisma();

  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('runs against a real PostgreSQL server', async () => {
    const rows = await prisma.$queryRaw<Array<{ version: string }>>`SELECT version()`;
    expect(rows[0]?.version).toMatch(/PostgreSQL/);
  });

  it('stores money as exact BigInt minor units', async () => {
    const user = await createTestUser();
    const workspace = await createTestWorkspace(user.id);
    const client = await createTestClient(workspace.id, user.id);

    const invoice = await prisma.invoice.create({
      data: {
        workspaceId: workspace.id,
        clientId: client.id,
        createdById: user.id,
        number: 'INV-0001',
        issueDate: new Date('2026-01-01T00:00:00Z'),
        dueDate: new Date('2026-01-15T00:00:00Z'),
        subtotalMinor: 100_000n,
        totalMinor: 100_000n,
      },
    });

    expect(invoice.totalMinor).toBe(100_000n);
    expect(typeof invoice.totalMinor).toBe('bigint');
  });

  it('enforces invoice number uniqueness per workspace only', async () => {
    const user = await createTestUser();
    const first = await createTestWorkspace(user.id);
    const second = await createTestWorkspace(user.id);
    const clientA = await createTestClient(first.id, user.id);
    const clientB = await createTestClient(second.id, user.id);

    const base = {
      number: 'INV-0001',
      issueDate: new Date('2026-01-01T00:00:00Z'),
      dueDate: new Date('2026-01-15T00:00:00Z'),
      subtotalMinor: 1_000n,
      totalMinor: 1_000n,
      createdById: user.id,
    };

    await prisma.invoice.create({
      data: { ...base, workspaceId: first.id, clientId: clientA.id },
    });
    await prisma.invoice.create({
      data: { ...base, workspaceId: second.id, clientId: clientB.id },
    });

    await expect(
      prisma.invoice.create({
        data: { ...base, workspaceId: first.id, clientId: clientA.id },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('cascades workspace deletion to its business records', async () => {
    const user = await createTestUser();
    const workspace = await createTestWorkspace(user.id);
    await createTestClient(workspace.id, user.id);

    await prisma.workspace.delete({ where: { id: workspace.id } });

    expect(await prisma.client.count({ where: { workspaceId: workspace.id } })).toBe(0);
  });

  it('keeps audit history when the acting user is deleted', async () => {
    const owner = await createTestUser();
    const actor = await createTestUser({ name: 'Delegated Actor' });
    const workspace = await createTestWorkspace(owner.id);
    await prisma.auditLog.create({
      data: {
        workspaceId: workspace.id,
        actorId: actor.id,
        actorEmail: actor.email,
        action: 'client.created',
        entityType: 'Client',
      },
    });

    // Workspace ownership is RESTRICTed, so the owner cannot be deleted while
    // a workspace still points at them. A team member can be, and the audit
    // entry must survive with the denormalised actor e-mail intact.
    await prisma.user.delete({ where: { id: actor.id } });

    const log = await prisma.auditLog.findFirstOrThrow({ where: { workspaceId: workspace.id } });
    expect(log.actorId).toBeNull();
    expect(log.actorEmail).toBe(actor.email);
  });
});
