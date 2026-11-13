import { describe, expect, it } from '@jest/globals';
import request from 'supertest';

import { createApp } from '../../app';
import { getPrisma } from '../../database/client';
import { parseCsv } from '../../http/csv';
import { resetDatabase } from '../../test-utils/db';

const app = createApp();
const prisma = getPrisma();

interface Session {
  accessToken: string;
  workspaceId: string;
  userId: string;
}

let counter = 0;

async function registerUser(): Promise<Session> {
  counter += 1;
  const response = await request(app)
    .post('/api/v1/auth/register')
    .send({
      email: `csv${counter}@example.test`,
      password: 'Str0ngPassword!',
      name: `CSV ${counter}`,
    });
  expect(response.status).toBe(201);
  return {
    accessToken: response.body.tokens.accessToken as string,
    workspaceId: response.body.workspace.workspaceId as string,
    userId: response.body.user.id as string,
  };
}

function api(session: Session) {
  const auth = (req: request.Test) =>
    req
      .set('Authorization', `Bearer ${session.accessToken}`)
      .set('X-Workspace-Id', session.workspaceId);

  return {
    get: (path: string) => auth(request(app).get(`/api/v1${path}`)),
    post: (path: string) => auth(request(app).post(`/api/v1${path}`)),
  };
}

describe('client CSV import and export', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('imports rows, normalises values and audits the batch', async () => {
    const owner = await registerUser();
    const csv = [
      'Name,E-mail,Company,Status,Tags,Billing Line 1,Billing City,Postal Code,Country',
      'Acme,Ops@Acme.test,Acme Ltd,active,"retainer;vip",1 Long Street,Cape Town,8001,ZA',
      'Northwind,,Northwind Design,LEAD,design,,, ,',
    ].join('\r\n');

    const response = await api(owner).post('/clients/import').send({ csv });

    expect(response.status).toBe(201);
    expect(response.body.import).toMatchObject({
      dryRun: false,
      total: 2,
      imported: 2,
      skipped: 0,
      errors: [],
    });

    const acme = await prisma.client.findFirstOrThrow({
      where: { workspaceId: owner.workspaceId, name: 'Acme' },
    });
    expect(acme.email).toBe('ops@acme.test');
    expect(acme.status).toBe('ACTIVE');
    expect(acme.tags).toEqual(['retainer', 'vip']);
    expect(acme.billingLine1).toBe('1 Long Street');
    expect(acme.billingCity).toBe('Cape Town');
    expect(acme.billingPostal).toBe('8001');
    expect(acme.billingCountry).toBe('ZA');

    const audit = await prisma.auditLog.findFirst({
      where: { workspaceId: owner.workspaceId, action: 'client.imported' },
    });
    expect(audit?.metadata).toMatchObject({ imported: 2, skipped: 0 });
  });

  it('supports a dry run that writes nothing', async () => {
    const owner = await registerUser();
    const response = await api(owner)
      .post('/clients/import')
      .send({ csv: 'name,email\nDry Run,dry@example.test\n', dryRun: true });

    expect(response.status).toBe(200);
    expect(response.body.import).toMatchObject({ dryRun: true, imported: 1 });
    expect(await prisma.client.count({ where: { workspaceId: owner.workspaceId } })).toBe(0);
    expect(
      await prisma.auditLog.count({
        where: { workspaceId: owner.workspaceId, action: 'client.imported' },
      }),
    ).toBe(0);
  });

  it('skips rows that duplicate the workspace, the file or the schema', async () => {
    const owner = await registerUser();
    await api(owner).post('/clients').send({ name: 'Existing', email: 'taken@example.test' });

    const csv = [
      'name,email',
      'Existing Two,taken@example.test', // duplicate e-mail in the workspace
      'Existing,', // duplicate name in the workspace
      'Fresh,fresh@example.test', // valid
      'Fresh Again,fresh@example.test', // duplicate e-mail earlier in this file
      ',nobody@example.test', // missing name
    ].join('\n');

    const response = await api(owner).post('/clients/import').send({ csv });

    expect(response.status).toBe(201);
    expect(response.body.import.total).toBe(5);
    expect(response.body.import.imported).toBe(1);
    expect(response.body.import.skipped).toBe(4);

    const messages = (response.body.import.errors as Array<{ message: string }>).map(
      (error) => error.message,
    );
    expect(messages.some((message) => message.includes('e-mail already belongs'))).toBe(true);
    expect(messages.some((message) => message.includes('name already exists'))).toBe(true);
    expect(messages.some((message) => message.includes('name'))).toBe(true);
    expect(await prisma.client.count({ where: { workspaceId: owner.workspaceId } })).toBe(2);
  });

  it('rejects a file without a name column', async () => {
    const owner = await registerUser();
    const response = await api(owner)
      .post('/clients/import')
      .send({ csv: 'email,company\na@b.test,Acme\n' });

    expect(response.status).toBe(400);
    expect(response.body.error.message).toMatch(/"name" column/);
  });

  it('caps the number of rows per file', async () => {
    const owner = await registerUser();
    const rows = Array.from({ length: 2_001 }, (_, index) => `Client ${index}`);
    const response = await api(owner)
      .post('/clients/import')
      .send({ csv: `name\n${rows.join('\n')}\n` });

    expect(response.status).toBe(400);
    expect(response.body.error.message).toMatch(/at most 2000/);
  });

  it('exports a CSV that round-trips through the importer', async () => {
    const owner = await registerUser();
    await api(owner)
      .post('/clients')
      .send({
        name: 'Northwind, Inc.',
        email: 'billing@northwind.test',
        company: 'Northwind',
        tags: ['retainer', 'design'],
        notes: 'Says "hello"\nsecond line',
      });

    const response = await api(owner).get('/clients/export');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.headers['content-disposition']).toContain('attachment;');

    const parsed = parseCsv(response.text);
    expect(parsed.headers[0]).toBe('name');
    expect(parsed.errors).toEqual([]);
    expect(parsed.records).toHaveLength(1);
    expect(parsed.records[0]?.values).toMatchObject({
      name: 'Northwind, Inc.',
      email: 'billing@northwind.test',
      tags: 'retainer|design',
      notes: 'Says "hello"\nsecond line',
    });

    // Importing the export into another workspace must succeed.
    const other = await registerUser();
    const imported = await api(other)
      .post('/clients/import')
      .send({ csv: response.text, dryRun: false });
    expect(imported.body.import).toMatchObject({ imported: 1, skipped: 0 });
  });

  it('does not let a viewer import clients', async () => {
    const owner = await registerUser();
    const viewer = await registerUser();
    await prisma.workspaceMember.create({
      data: {
        workspaceId: owner.workspaceId,
        userId: viewer.userId,
        role: 'VIEWER',
        acceptedAt: new Date(),
      },
    });

    const response = await api({ ...viewer, workspaceId: owner.workspaceId })
      .post('/clients/import')
      .send({ csv: 'name\nNope\n' });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });
});
