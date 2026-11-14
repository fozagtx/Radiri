import { defineConfig } from "prisma/config";

/**
 * Prisma 7 configuration for the optional PostgreSQL index (see prisma/schema.prisma).
 * `prisma generate` needs no database and no network; migrations read DATABASE_URL from the
 * environment (Prisma 7 does not load .env files by itself).
 */
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env.DATABASE_URL ?? "",
  },
});
