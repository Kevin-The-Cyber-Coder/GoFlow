import { PrismaClient } from '@prisma/client';

/**
 * Lazily created Prisma client.
 *
 * A module-level `new PrismaClient()` would make importing the app connect to
 * the database as a side effect, which breaks unit tests and health checks
 * that do not need persistence. The client is created on first use instead, so
 * a missing DATABASE_URL fails at the first query rather than at import time.
 */
let client: PrismaClient | undefined;

export function getPrisma(): PrismaClient {
  if (client === undefined) {
    const url = process.env.DATABASE_URL;
    if (url === undefined || url.length === 0) {
      throw new Error('DATABASE_URL is not set.');
    }

    client = new PrismaClient({
      datasources: { db: { url } },
      log: process.env.NODE_ENV === 'test' ? [] : ['warn', 'error'],
    });
  }

  return client;
}

export async function disconnectPrisma(): Promise<void> {
  if (client !== undefined) {
    await client.$disconnect();
    client = undefined;
  }
}
