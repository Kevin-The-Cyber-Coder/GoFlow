import type { ClientStatus, Prisma } from '@prisma/client';

import { getPrisma } from '../../database/client';
import { parseCsv, toCsv, CsvFormatError } from '../../http/csv';
import { ApiError } from '../../http/errors';
import { recordAudit } from '../audit/service';
import type { RequestMeta } from './service';
import { createClientSchema } from './schemas';

export const MAX_IMPORT_ROWS = 2_000;
export const MAX_EXPORT_ROWS = 5_000;

/** Columns written by the exporter, in order. */
const EXPORT_COLUMNS = [
  'name',
  'company',
  'email',
  'phone',
  'billing_line1',
  'billing_line2',
  'billing_city',
  'billing_postal',
  'billing_country',
  'category',
  'status',
  'tags',
  'notes',
] as const;

/**
 * Import header aliases. Every name is normalised (lower-case, `-`/space to
 * `_`) before lookup, so "E-mail", "billing-line-1" and "ZIP" all land on the
 * right field.
 */
const HEADER_ALIASES: Record<string, string> = {
  client: 'name',
  client_name: 'name',
  company_name: 'company',
  email: 'email',
  e_mail: 'email',
  phone: 'phone',
  telephone: 'phone',
  billing_line_1: 'billing_line1',
  address_line_1: 'billing_line1',
  billing_line_2: 'billing_line2',
  address_line_2: 'billing_line2',
  city: 'billing_city',
  billing_city: 'billing_city',
  postal_code: 'billing_postal',
  postcode: 'billing_postal',
  zip: 'billing_postal',
  billing_postal: 'billing_postal',
  country: 'billing_country',
  billing_country: 'billing_country',
  category: 'category',
  status: 'status',
  tags: 'tags',
  notes: 'notes',
};

function normaliseHeader(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .replaceAll(/[\s-]+/g, '_');
}

/** CSV column names use snake_case; schema inputs use camelCase. */
const SCHEMA_FIELDS: Record<string, string> = {
  billing_line1: 'billingLine1',
  billing_line2: 'billingLine2',
  billing_city: 'billingCity',
  billing_postal: 'billingPostal',
  billing_country: 'billingCountry',
};

function fieldFor(header: string): string | undefined {
  const normalised = normaliseHeader(header);
  return EXPORT_COLUMNS.includes(normalised as (typeof EXPORT_COLUMNS)[number])
    ? normalised
    : HEADER_ALIASES[normalised];
}

export interface ImportSummary {
  readonly dryRun: boolean;
  readonly total: number;
  readonly imported: number;
  readonly skipped: number;
  readonly errors: Array<{ line: number; message: string }>;
}

export async function importClients(
  workspaceId: string,
  actorId: string,
  actorEmail: string,
  csv: string,
  dryRun: boolean,
  meta: RequestMeta,
): Promise<ImportSummary> {
  const prisma = getPrisma();

  let parsed;
  try {
    parsed = parseCsv(csv);
  } catch (error) {
    if (error instanceof CsvFormatError) {
      throw ApiError.badRequest(error.message, { line: error.line });
    }
    throw error;
  }

  const mapping = new Map<string, string>();
  for (const header of parsed.headers) {
    const field = fieldFor(header);
    if (field !== undefined && !mapping.has(field)) {
      mapping.set(field, header);
    }
  }

  if (!mapping.has('name')) {
    throw ApiError.badRequest('The CSV must include a "name" column.');
  }
  if (parsed.records.length > MAX_IMPORT_ROWS) {
    throw ApiError.badRequest(
      `Import at most ${MAX_IMPORT_ROWS} clients per file; split the file and try again.`,
      { rows: parsed.records.length },
    );
  }

  const existing = await prisma.client.findMany({
    where: { workspaceId, deletedAt: null },
    select: { email: true, name: true },
  });
  const seenEmails = new Set(
    existing.flatMap((client) => (client.email === null ? [] : [client.email.toLowerCase()])),
  );
  const seenNames = new Set(existing.map((client) => client.name.toLowerCase()));

  const errors: Array<{ line: number; message: string }> = [...parsed.errors];
  const valid: Prisma.ClientCreateManyInput[] = [];

  for (const record of parsed.records) {
    const raw: Record<string, string> = {};
    for (const [field, header] of mapping) {
      const value = record.values[header] ?? '';
      if (value.length > 0) {
        raw[SCHEMA_FIELDS[field] ?? field] = field === 'status' ? value.toUpperCase() : value;
      }
    }

    const candidate = {
      ...raw,
      ...(raw.tags === undefined
        ? {}
        : {
            tags: raw.tags
              .split(/[;,|]/u)
              .map((tag) => tag.trim())
              .filter(Boolean),
          }),
    };

    const result = createClientSchema.safeParse(candidate);
    if (!result.success) {
      const first = result.error.issues[0];
      errors.push({
        line: record.line,
        message:
          first === undefined
            ? 'The row is invalid.'
            : `${first.path.join('.') || 'row'}: ${first.message}`,
      });
      continue;
    }

    const emailKey = result.data.email?.toLowerCase();
    const nameKey = result.data.name.toLowerCase();
    if (emailKey !== undefined && seenEmails.has(emailKey)) {
      errors.push({ line: record.line, message: 'That e-mail already belongs to a client.' });
      continue;
    }
    if (emailKey === undefined && seenNames.has(nameKey)) {
      errors.push({ line: record.line, message: 'A client with that name already exists.' });
      continue;
    }

    if (emailKey !== undefined) {
      seenEmails.add(emailKey);
    }
    seenNames.add(nameKey);

    valid.push({
      workspaceId,
      createdById: actorId,
      name: result.data.name,
      company: result.data.company ?? null,
      email: result.data.email ?? null,
      phone: result.data.phone ?? null,
      billingLine1: result.data.billingLine1 ?? null,
      billingLine2: result.data.billingLine2 ?? null,
      billingCity: result.data.billingCity ?? null,
      billingPostal: result.data.billingPostal ?? null,
      billingCountry: result.data.billingCountry ?? null,
      category: result.data.category ?? null,
      status: (result.data.status ?? 'LEAD') as ClientStatus,
      notes: result.data.notes ?? null,
      tags: result.data.tags ?? [],
    });
  }

  if (!dryRun && valid.length > 0) {
    await prisma.client.createMany({ data: valid });
    await recordAudit({
      workspaceId,
      actorId,
      actorEmail,
      action: 'client.imported',
      entityType: 'Client',
      metadata: { imported: valid.length, skipped: errors.length },
      ...meta,
    });
  }

  return {
    dryRun,
    total: parsed.records.length,
    imported: valid.length,
    skipped: errors.length,
    errors,
  };
}

export async function exportClientsCsv(workspaceId: string): Promise<string> {
  const clients = await getPrisma().client.findMany({
    where: { workspaceId, deletedAt: null },
    orderBy: { name: 'asc' },
    take: MAX_EXPORT_ROWS,
    select: {
      name: true,
      company: true,
      email: true,
      phone: true,
      billingLine1: true,
      billingLine2: true,
      billingCity: true,
      billingPostal: true,
      billingCountry: true,
      category: true,
      status: true,
      tags: true,
      notes: true,
    },
  });

  return toCsv(
    EXPORT_COLUMNS,
    clients.map((client) => [
      client.name,
      client.company,
      client.email,
      client.phone,
      client.billingLine1,
      client.billingLine2,
      client.billingCity,
      client.billingPostal,
      client.billingCountry,
      client.category,
      client.status,
      client.tags.join('|'),
      client.notes,
    ]),
  );
}
