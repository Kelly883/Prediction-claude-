import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { __resetPrismaForTests } from '@/lib/prisma';

// Hoisted mutable state shared with the mocked PrismaClient constructor so each
// test can inject a fully controlled fake instance before the wrapper is loaded.
const h = vi.hoisted(() => ({
  state: { instance: null as any, ctorCalls: 0 },
}));

vi.mock('@prisma/client', () => {
  class PrismaClient {
    constructor() {
      h.state.ctorCalls += 1;
      if (h.state.instance) return h.state.instance;
      return {
        $transaction: async () => undefined,
        $connect: async () => undefined,
        $disconnect: async () => undefined,
      };
    }
  }
  return { PrismaClient };
});

type EnvSnapshot = {
  DATABASE_URL?: string;
  NODE_ENV?: string;
  IN_MEMORY_DB?: string;
  INTEGRATION_TEST?: string;
};

let savedEnv: EnvSnapshot = {};

function snapshotEnv(): void {
  savedEnv = {
    DATABASE_URL: process.env.DATABASE_URL,
    NODE_ENV: process.env.NODE_ENV,
    IN_MEMORY_DB: process.env.IN_MEMORY_DB,
    INTEGRATION_TEST: process.env.INTEGRATION_TEST,
  };
}

function restoreEnv(): void {
  const keys: (keyof EnvSnapshot)[] = ['DATABASE_URL', 'NODE_ENV', 'IN_MEMORY_DB', 'INTEGRATION_TEST'];
  for (const key of keys) {
    const value = savedEnv[key];
    if (value === undefined) delete process.env[key];
    else (process.env as any)[key] = value;
  }
}

/**
 * Load a fresh instance of the Prisma wrapper under a controlled environment.
 * The module reads DATABASE_URL / NODE_ENV at initialization time, so the
 * registry and cached globals must be cleared before each controlled import.
 */
async function loadWrapper(overrides: { DATABASE_URL?: string | null; NODE_ENV?: string }) {
  if ('DATABASE_URL' in overrides) {
    const value = overrides.DATABASE_URL;
    if (value === null || value === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = value;
  }
  if (overrides.NODE_ENV !== undefined) {
    (process.env as any).NODE_ENV = overrides.NODE_ENV;
  }

  vi.resetModules();
  const g = globalThis as any;
  delete g.prisma;
  delete g.inMemoryDb;

  const mod: any = await import('@/lib/prisma');
  return mod.prisma as any;
}

const DB_URL = 'postgresql://wrapper-test:test@localhost:5432/wrapper_test';

beforeEach(() => {
  snapshotEnv();
  h.state.instance = null;
  h.state.ctorCalls = 0;
  __resetPrismaForTests();
});

afterEach(() => {
  restoreEnv();
  h.state.instance = null;
  __resetPrismaForTests();
  vi.resetModules();
});

describe('Prisma wrapper: transaction delegation (mocked real client)', () => {
  it('delegates callback-form $transaction to the real Prisma client', async () => {
    const txClient = { marker: 'tx-scoped' };
    const sentinel = { ok: true };
    const fake: any = {
      $transaction: vi.fn(async (cb: any) => {
        expect(typeof cb).toBe('function');
        return cb(txClient);
      }),
      $connect: vi.fn(async () => undefined),
      $disconnect: vi.fn(async () => undefined),
    };
    h.state.instance = fake;

    const prisma = await loadWrapper({ DATABASE_URL: DB_URL, NODE_ENV: 'test' });
    const result = await prisma.$transaction(async () => sentinel);

    expect(fake.$transaction).toHaveBeenCalledTimes(1);
    expect(result).toBe(sentinel);
  });

  it('passes the transaction-scoped client to the callback (not the global wrapper)', async () => {
    const txClient = { marker: 'tx-scoped' };
    const fake: any = {
      $transaction: vi.fn(async (cb: any) => cb(txClient)),
    };
    h.state.instance = fake;

    const prisma = await loadWrapper({ DATABASE_URL: DB_URL, NODE_ENV: 'test' });
    let received: any;
    await prisma.$transaction(async (tx: any) => {
      received = tx;
    });

    expect(received).toBe(txClient);
    expect(received).not.toBe(prisma);
  });

  it('propagates callback failure so the real transaction rolls back', async () => {
    const boom = new Error('callback boom');
    const fake: any = {
      // Mimic real Prisma: run the callback and surface any error unchanged.
      $transaction: vi.fn(async (cb: any) => {
        return await cb({ marker: 'tx' });
      }),
    };
    h.state.instance = fake;

    const prisma = await loadWrapper({ DATABASE_URL: DB_URL, NODE_ENV: 'test' });
    await expect(
      prisma.$transaction(async () => {
        throw boom;
      })
    ).rejects.toBe(boom);
    expect(fake.$transaction).toHaveBeenCalledTimes(1);
  });

  it('delegates array-form $transaction to the real Prisma API (not Promise.all)', async () => {
    const fake: any = {
      $transaction: vi.fn(async (arr: any[]) => ({ count: arr.length })),
    };
    h.state.instance = fake;

    const prisma = await loadWrapper({ DATABASE_URL: DB_URL, NODE_ENV: 'test' });
    const opA = vi.fn();
    const opB = vi.fn();
    const result = await prisma.$transaction([opA, opB]);

    expect(fake.$transaction).toHaveBeenCalledTimes(1);
    const passed = fake.$transaction.mock.calls[0][0];
    expect(Array.isArray(passed)).toBe(true);
    expect(passed).toHaveLength(2);
    // Promise.all would have invoked the operations; delegation must not.
    expect(opA).not.toHaveBeenCalled();
    expect(opB).not.toHaveBeenCalled();
    expect(result).toEqual({ count: 2 });
  });
});

describe('Prisma wrapper: configured DATABASE_URL propagates errors (no memory fallback)', () => {
  it('propagates P2002 without falling back to in-memory', async () => {
    const p2002: any = new Error('Unique constraint failed');
    p2002.code = 'P2002';
    const fake: any = {
      user: { create: vi.fn(async () => Promise.reject(p2002)) },
      $transaction: vi.fn(),
    };
    h.state.instance = fake;

    const prisma = await loadWrapper({ DATABASE_URL: DB_URL, NODE_ENV: 'production' });
    await expect(prisma.user.create({ data: { email: 'dup@example.com' } })).rejects.toMatchObject({
      code: 'P2002',
    });

    // No in-memory record should have been written by a fallback.
    const g = globalThis as any;
    expect(g.inMemoryDb.User.length).toBe(0);
  });

  it('propagates database connection errors without falling back to in-memory', async () => {
    const connErr = new Error("Can't reach database server at localhost:5432");
    const fake: any = {
      user: { findMany: vi.fn(async () => Promise.reject(connErr)) },
    };
    h.state.instance = fake;

    const prisma = await loadWrapper({ DATABASE_URL: DB_URL, NODE_ENV: 'test' });
    await expect(prisma.user.findMany()).rejects.toBe(connErr);

    const g = globalThis as any;
    expect(g.inMemoryDb.User.length).toBe(0);
  });

  it('propagates query execution errors without falling back to in-memory', async () => {
    const queryErr = new Error('relation "User" does not exist');
    const fake: any = {
      user: { findUnique: vi.fn(async () => Promise.reject(queryErr)) },
    };
    h.state.instance = fake;

    const prisma = await loadWrapper({ DATABASE_URL: DB_URL, NODE_ENV: 'production' });
    await expect(prisma.user.findUnique({ where: { id: 'x' } })).rejects.toBe(queryErr);

    const g = globalThis as any;
    expect(g.inMemoryDb.User.length).toBe(0);
  });
});

describe('Prisma wrapper: fail-closed behavior', () => {
  it('production without DATABASE_URL fails closed on model access', async () => {
    const prisma = await loadWrapper({ DATABASE_URL: null, NODE_ENV: 'production' });

    await expect(prisma.user.findMany()).rejects.toThrow(/DATABASE_URL is not configured/);

    const g = globalThis as any;
    expect(g.inMemoryDb.User.length).toBe(0);
  });

  it('production without DATABASE_URL fails closed on $transaction and $connect', async () => {
    const prisma = await loadWrapper({ DATABASE_URL: null, NODE_ENV: 'production' });

    await expect(prisma.$transaction(async () => 'ok')).rejects.toThrow(/DATABASE_URL is not configured/);
    await expect(prisma.$transaction([vi.fn()])).rejects.toThrow(/DATABASE_URL is not configured/);
    await expect(prisma.$connect()).rejects.toThrow(/DATABASE_URL is not configured/);
  });

  it('unit tests without DATABASE_URL still use explicitly isolated in-memory storage', async () => {
    const prisma = await loadWrapper({ DATABASE_URL: null, NODE_ENV: 'test' });

    const created = await prisma.user.create({ data: { email: 'iso@example.com' } });
    expect(created.email).toBe('iso@example.com');

    const all = await prisma.user.findMany();
    expect(all).toHaveLength(1);
    expect(all[0].email).toBe('iso@example.com');
  });
});

describe('Prisma wrapper: in-memory test isolation', () => {
  it('reset clears the in-memory store between tests', async () => {
    const prisma = await loadWrapper({ DATABASE_URL: null, NODE_ENV: 'test' });
    await prisma.user.create({ data: { email: 'leak-check@example.com' } });

    const g = globalThis as any;
    expect(g.inMemoryDb.User.length).toBe(1);

    __resetPrismaForTests();

    expect(g.inMemoryDb.User.length).toBe(0);
    expect(g.prisma).toBeUndefined();
  });
});