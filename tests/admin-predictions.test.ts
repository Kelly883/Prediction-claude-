import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockPrisma = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  plan: { findMany: vi.fn(), create: vi.fn() },
  predictionPost: { create: vi.fn(), update: vi.fn(), findUnique: vi.fn() },
  auditLog: { create: vi.fn() },
}));

vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));
vi.mock('@/lib/rbac', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    requirePermission: vi.fn().mockResolvedValue({ sub: 'admin-1', role: 'admin', permissions: [] }),
    hasPermission: vi.fn().mockReturnValue(true),
  };
});
vi.mock('@/lib/audit', () => ({
  writeAudit: vi.fn().mockResolvedValue({ id: 'audit-1' }),
}));

import { POST as createPrediction } from '@/app/api/admin/predictions/route';
import { PATCH as updatePrediction } from '@/app/api/admin/predictions/[id]/route';

describe('Admin Predictions API - Plan Specific Visibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a prediction post with plan_specific visibility and planIds', async () => {
    const mockPost = {
      id: 'post-100',
      title: 'VIP Weekend Picks',
      scheduledAt: new Date('2026-08-10T15:00:00Z'),
      categoryIds: [],
      bookingCode: 'VIP-99',
      bodyNotes: undefined,
      visibility: 'plan_specific',
      planIds: ['plan-1', 'plan-2'],
      status: 'draft',
      createdById: 'admin-1',
    };
    mockPrisma.predictionPost.create.mockResolvedValue(mockPost);

    const body = {
      title: 'VIP Weekend Picks',
      scheduledAt: '2026-08-10T15:00:00.000Z',
      bookingCode: 'VIP-99',
      visibility: 'plan_specific',
      planIds: ['plan-1', 'plan-2'],
      items: [{ match: 'Arsenal vs Chelsea', prediction: '1' }],
    };

    const req = new NextRequest('http://localhost:3000/api/admin/predictions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const res = await createPrediction(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.visibility).toBe('plan_specific');
    expect(json.planIds).toEqual(['plan-1', 'plan-2']);

    expect(mockPrisma.predictionPost.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        title: 'VIP Weekend Picks',
        visibility: 'plan_specific',
        planIds: ['plan-1', 'plan-2'],
        createdById: 'admin-1',
      }),
    });
  });

  it('updates an existing prediction post with updated planIds', async () => {
    const existingPost = {
      id: 'post-100',
      title: 'Old Title',
      visibility: 'subscribers',
      planIds: [],
      items: [],
      outcome: 'pending',
    };
    const updatedPost = {
      id: 'post-100',
      title: 'Updated VIP Picks',
      visibility: 'plan_specific',
      planIds: ['plan-3'],
      items: [],
      outcome: 'pending',
    };
    mockPrisma.predictionPost.findUnique.mockResolvedValue(existingPost);
    mockPrisma.predictionPost.update.mockResolvedValue(updatedPost);

    const body = {
      title: 'Updated VIP Picks',
      visibility: 'plan_specific',
      planIds: ['plan-3'],
    };

    const req = new NextRequest('http://localhost:3000/api/admin/predictions/post-100', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const res = await updatePrediction(req, { params: Promise.resolve({ id: 'post-100' }) });
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.planIds).toEqual(['plan-3']);

    expect(mockPrisma.predictionPost.update).toHaveBeenCalledWith({
      where: { id: 'post-100' },
      data: expect.objectContaining({
        title: 'Updated VIP Picks',
        visibility: 'plan_specific',
        planIds: ['plan-3'],
      }),
    });
  });

  it('auto-archives post when outcome is set to won', async () => {
    const existingPost = {
      id: 'post-100',
      title: 'Old Title',
      status: 'published',
      outcome: 'pending',
      items: [],
    };
    const updatedPost = {
      id: 'post-100',
      title: 'Old Title',
      status: 'archived',
      outcome: 'won',
      items: [],
    };
    mockPrisma.predictionPost.findUnique.mockResolvedValue(existingPost);
    mockPrisma.predictionPost.update.mockResolvedValue(updatedPost);

    const body = { outcome: 'won' };

    const req = new NextRequest('http://localhost:3000/api/admin/predictions/post-100', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const res = await updatePrediction(req, { params: Promise.resolve({ id: 'post-100' }) });
    expect(res.status).toBe(200);

    expect(mockPrisma.predictionPost.update).toHaveBeenCalledWith({
      where: { id: 'post-100' },
      data: expect.objectContaining({
        outcome: 'won',
        status: 'archived',
      }),
    });
  });

  it('auto-archives post when outcome is set to lost', async () => {
    const existingPost = {
      id: 'post-100',
      title: 'Old Title',
      status: 'published',
      outcome: 'pending',
      items: [],
    };
    const updatedPost = {
      id: 'post-100',
      title: 'Old Title',
      status: 'archived',
      outcome: 'lost',
      items: [],
    };
    mockPrisma.predictionPost.findUnique.mockResolvedValue(existingPost);
    mockPrisma.predictionPost.update.mockResolvedValue(updatedPost);

    const body = { outcome: 'lost' };

    const req = new NextRequest('http://localhost:3000/api/admin/predictions/post-100', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const res = await updatePrediction(req, { params: Promise.resolve({ id: 'post-100' }) });
    expect(res.status).toBe(200);

    expect(mockPrisma.predictionPost.update).toHaveBeenCalledWith({
      where: { id: 'post-100' },
      data: expect.objectContaining({
        outcome: 'lost',
        status: 'archived',
      }),
    });
  });

  it('does not change status when outcome remains pending', async () => {
    const existingPost = {
      id: 'post-100',
      title: 'Old Title',
      status: 'published',
      outcome: 'pending',
      items: [],
    };
    const updatedPost = {
      id: 'post-100',
      title: 'Updated Title',
      status: 'published',
      outcome: 'pending',
      items: [],
    };
    mockPrisma.predictionPost.findUnique.mockResolvedValue(existingPost);
    mockPrisma.predictionPost.update.mockResolvedValue(updatedPost);

    const body = { title: 'Updated Title', outcome: 'pending' };

    const req = new NextRequest('http://localhost:3000/api/admin/predictions/post-100', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const res = await updatePrediction(req, { params: Promise.resolve({ id: 'post-100' }) });
    expect(res.status).toBe(200);

    expect(mockPrisma.predictionPost.update).toHaveBeenCalledWith({
      where: { id: 'post-100' },
      data: expect.objectContaining({
        title: 'Updated Title',
        status: 'published',
        outcome: 'pending',
      }),
    });
  });
});
