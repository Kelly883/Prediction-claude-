import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST, GET } from '@/app/api/admin/predictions/[id]/images/route';
import { prisma } from '@/lib/prisma';
import * as rbac from '@/lib/rbac';
import * as ratelimit from '@/lib/ratelimit';
import * as media from '@/lib/media';
import sharp from 'sharp';

describe('Admin Prediction Image Upload API Route Security', () => {
  let sampleJpegBuffer: Buffer;

  beforeEach(async () => {
    vi.restoreAllMocks();

    sampleJpegBuffer = await sharp({
      create: {
        width: 100,
        height: 100,
        channels: 3,
        background: { r: 255, g: 0, b: 0 },
      },
    })
      .jpeg()
      .toBuffer();
  });

  function createMultipartRequest(url: string, file?: File | null, headers: Record<string, string> = {}): NextRequest {
    const formData = new FormData();
    if (file) {
      formData.append('file', file);
    }

    return new NextRequest(url, {
      method: 'POST',
      body: formData,
      headers: {
        ...headers,
      },
    });
  }

  describe('Authentication & RBAC Authorization Checks', () => {
    it('rejects unauthenticated requests with 401 Unauthorized', async () => {
      vi.spyOn(rbac, 'requireAdmin').mockRejectedValueOnce(new rbac.ApiError(401, 'Missing session'));

      const req = createMultipartRequest('http://localhost:3000/api/admin/predictions/p1/images', null);
      const res = await POST(req, { params: Promise.resolve({ id: 'p1' }) });
      const data = await res.json();

      expect(res.status).toBe(401);
      expect(data.error).toBe('Missing session');
    });

    it('rejects standard users (role: user) with 403 Forbidden', async () => {
      vi.spyOn(rbac, 'requireAdmin').mockRejectedValueOnce(new rbac.ApiError(403, 'Insufficient permissions'));

      const req = createMultipartRequest('http://localhost:3000/api/admin/predictions/p1/images', null);
      const res = await POST(req, { params: Promise.resolve({ id: 'p1' }) });
      const data = await res.json();

      expect(res.status).toBe(403);
      expect(data.error).toBe('Insufficient permissions');
    });
  });

  describe('CSRF & Cross-Origin Verification', () => {
    it('rejects cross-origin upload requests (CSRF defense)', async () => {
      vi.spyOn(rbac, 'requireAdmin').mockResolvedValueOnce({ sub: 'admin_1', role: 'admin' });
      vi.spyOn(ratelimit, 'checkRateLimit').mockResolvedValueOnce(true);

      const req = createMultipartRequest('http://localhost:3000/api/admin/predictions/p1/images', null, {
        host: 'localhost:3000',
        origin: 'https://malicious-attacker.com',
      });

      const res = await POST(req, { params: Promise.resolve({ id: 'p1' }) });
      const data = await res.json();

      expect(res.status).toBe(403);
      expect(data.error).toBe('Forbidden cross-origin upload request.');
    });
  });

  describe('Rate Limiting', () => {
    it('rejects requests exceeding admin upload rate limit with 429 Too Many Requests', async () => {
      vi.spyOn(rbac, 'requireAdmin').mockResolvedValueOnce({ sub: 'admin_1', role: 'admin' });
      vi.spyOn(ratelimit, 'checkRateLimit').mockResolvedValueOnce(false); // Exceeded

      const req = createMultipartRequest('http://localhost:3000/api/admin/predictions/p1/images', null);
      const res = await POST(req, { params: Promise.resolve({ id: 'p1' }) });
      const data = await res.json();

      expect(res.status).toBe(429);
      expect(data.error).toContain('Too many upload attempts');
    });
  });

  describe('Validation & Quota Controls', () => {
    it('rejects upload when maximum images per prediction post is reached (10 images)', async () => {
      vi.spyOn(rbac, 'requireAdmin').mockResolvedValueOnce({ sub: 'admin_1', role: 'admin' });
      vi.spyOn(ratelimit, 'checkRateLimit').mockResolvedValueOnce(true);
      vi.spyOn(prisma.mediaAsset, 'count').mockResolvedValueOnce(10); // Quota reached

      const file = new File([new Uint8Array(sampleJpegBuffer)], 'test.jpg', { type: 'image/jpeg' });
      const req = createMultipartRequest('http://localhost:3000/api/admin/predictions/p1/images', file);
      const res = await POST(req, { params: Promise.resolve({ id: 'p1' }) });
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.error).toContain('Maximum of 10 images reached');
    });

    it('rejects request when file is missing from multipart form data', async () => {
      vi.spyOn(rbac, 'requireAdmin').mockResolvedValueOnce({ sub: 'admin_1', role: 'admin' });
      vi.spyOn(ratelimit, 'checkRateLimit').mockResolvedValueOnce(true);
      vi.spyOn(prisma.mediaAsset, 'count').mockResolvedValueOnce(2);

      const req = createMultipartRequest('http://localhost:3000/api/admin/predictions/p1/images', null);
      const res = await POST(req, { params: Promise.resolve({ id: 'p1' }) });
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.error).toBe('Image file is required.');
    });

    it('successfully uploads valid image and returns sanitized metadata payload with safe URL', async () => {
      vi.spyOn(rbac, 'requireAdmin').mockResolvedValueOnce({ sub: 'admin_1', role: 'admin' });
      vi.spyOn(ratelimit, 'checkRateLimit').mockResolvedValueOnce(true);
      vi.spyOn(prisma.mediaAsset, 'count').mockResolvedValueOnce(0);

      vi.spyOn(media, 'uploadMedia').mockResolvedValueOnce({
        id: 'asset_777',
        postId: 'p1',
        url: '/api/media/asset_777/raw',
        storageKey: 'predictions/p1/random-uuid.jpg',
        mimeType: 'image/jpeg',
        width: 100,
        height: 100,
        size: sampleJpegBuffer.length,
        sha256: 'a1b2c3d4e5f6',
      });

      const file = new File([new Uint8Array(sampleJpegBuffer)], 'valid-chart.jpg', { type: 'image/jpeg' });
      const req = createMultipartRequest('http://localhost:3000/api/admin/predictions/p1/images', file);
      const res = await POST(req, { params: Promise.resolve({ id: 'p1' }) });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.message).toBe('Prediction image uploaded successfully.');
      expect(json.data.id).toBe('asset_777');
      expect(json.data.url).toBe('/api/media/asset_777/raw');
      expect(json.data.mime_type).toBe('image/jpeg');
      expect(json.data.width).toBe(100);
      expect(json.data.height).toBe(100);
      expect(json.data.sha256).toBe('a1b2c3d4e5f6');
    });
  });
});
