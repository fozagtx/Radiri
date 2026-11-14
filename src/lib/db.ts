import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";

/**
 * Optional PostgreSQL index (Prisma 7 + @prisma/adapter-pg). INDEXING ONLY: never a source of truth
 * for balances or debt; the chain and the 1Click status API are. Without DATABASE_URL nothing here
 * loads (the client and pg are imported lazily) and callers report `{ enabled: false, reason }`.
 */

export type DatabaseState = { enabled: true } | { enabled: false; reason: string };

export function databaseState(): DatabaseState {
  return process.env.DATABASE_URL?.trim()
    ? { enabled: true }
    : {
        enabled: false,
        reason:
          "DATABASE_URL is not set, so the optional PostgreSQL index is off. Swap history stays in this browser; balances and debt always come from the chain.",
      };
}

const globalForDb = globalThis as unknown as { radiriPrisma?: Promise<PrismaClient> };

/** Shared Prisma client, or null when no database is configured. */
export async function getDb(): Promise<PrismaClient | null> {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) return null;
  if (!globalForDb.radiriPrisma) {
    globalForDb.radiriPrisma = (async () => {
      const [{ PrismaClient: Client }, { PrismaPg }] = await Promise.all([
        import("@/generated/prisma/client"),
        import("@prisma/adapter-pg"),
      ]);
      return new Client({ adapter: new PrismaPg({ connectionString: url }) });
    })();
    globalForDb.radiriPrisma.catch(() => {
      globalForDb.radiriPrisma = undefined;
    });
  }
  return globalForDb.radiriPrisma;
}
