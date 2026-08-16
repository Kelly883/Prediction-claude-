import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPrisma = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));

import { GET as healthGet } from '@/app/api/health/route';

describe('health endpoint', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns ok when database responds', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([{ '1': 1 }]);

    const req = new Request('http://localhost/api/health');
    const res = await healthGet(req as any);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.status).toBe('ok');
    expect(json.checks.database.status).toBe('ok');
    expect(typeof json.checks.database.latencyMs).toBe('number');
  });

  it('returns 500 when database fails', async () => {
    mockPrisma.$queryRaw.mockRejectedValue(new Error('DB down'));

    const req = new Request('http://localhost/api/health');
    const res = await healthGet(req as any);
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.status).toBe('error');
    expect(json.checks.database.status).toBe('error');
  });
});
