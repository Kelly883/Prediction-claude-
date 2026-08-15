import { PrismaClient } from '@prisma/client';

// Standard Next.js/serverless pattern: cache the client on `globalThis` so
// hot-reloads in dev and repeated invocations within the same warm Lambda
// don't each open a fresh connection. Combined with a pooled DATABASE_URL
// (Neon/Supabase pooler), this keeps connection counts sane under bursty
// serverless traffic — a raw PrismaClient-per-request would exhaust Postgres
// connection limits almost immediately.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: [],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
