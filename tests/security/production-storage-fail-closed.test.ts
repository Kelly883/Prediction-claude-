import { describe, it, expect, vi, beforeEach } from 'vitest';
import sharp from 'sharp';

function createValidJpegBuffer(): Promise<Buffer> {
  return sharp({
    create: {
      width: 100,
      height: 100,
      channels: 3,
      background: { r: 255, g: 0, b: 0 },
    },
  })
    .jpeg()
    .toBuffer();
}

vi.mock('@/lib/prisma', () => ({
  prisma: {
    predictionPost: {
      findUnique: vi.fn(async () => ({ id: 'post-1' })),
    },
    mediaAsset: {
      create: vi.fn(async ({ data }: any) => ({ id: 'media-1', ...data })),
    },
  },
}));

vi.mock('@/lib/entitlement', () => ({
  canView: vi.fn(async () => true),
}));

describe('P0-06 Production Storage Fail-Closed', () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.S3_BUCKET;
    delete process.env.S3_ACCESS_KEY_ID;
    delete process.env.S3_SECRET_ACCESS_KEY;
  });

  it('allows local fallback in development when S3 is missing', async () => {
    (process.env as any).NODE_ENV = 'development';
    const { uploadMedia } = await import('@/lib/media');
    const buffer = await createValidJpegBuffer();

    const file = new File([buffer.buffer as ArrayBuffer], 'test.jpg', { type: 'image/jpeg' });
    const result = await uploadMedia('post-1', file);
    expect(result.id).toBe('media-1');
  });

  it('allows local fallback in test when S3 is missing', async () => {
    (process.env as any).NODE_ENV = 'test';
    const { uploadMedia } = await import('@/lib/media');
    const buffer = await createValidJpegBuffer();

    const file = new File([buffer.buffer as ArrayBuffer], 'test.jpg', { type: 'image/jpeg' });
    const result = await uploadMedia('post-1', file);
    expect(result.id).toBe('media-1');
  });

  it('fails closed in production when S3 is missing', async () => {
    (process.env as any).NODE_ENV = 'production';
    const { uploadMedia } = await import('@/lib/media');
    const buffer = await createValidJpegBuffer();

    const file = new File([buffer.buffer as ArrayBuffer], 'test.jpg', { type: 'image/jpeg' });
    await expect(uploadMedia('post-1', file)).rejects.toThrow('Storage service is not configured');
  });

  it('fails closed in production when S3 is configured as ci-placeholder', async () => {
    (process.env as any).NODE_ENV = 'production';
    process.env.S3_BUCKET = 'ci-placeholder';
    process.env.S3_ACCESS_KEY_ID = 'ci-placeholder';
    process.env.S3_SECRET_ACCESS_KEY = 'ci-placeholder';
    const { uploadMedia } = await import('@/lib/media');
    const buffer = await createValidJpegBuffer();

    const file = new File([buffer.buffer as ArrayBuffer], 'test.jpg', { type: 'image/jpeg' });
    await expect(uploadMedia('post-1', file)).rejects.toThrow('Storage service is not configured');
  });

  it('allows S3 in production when properly configured', async () => {
    (process.env as any).NODE_ENV = 'production';
    process.env.S3_BUCKET = 'real-bucket';
    process.env.S3_ACCESS_KEY_ID = 'real-key';
    process.env.S3_SECRET_ACCESS_KEY = 'real-secret';
    const { uploadMedia } = await import('@/lib/media');
    const buffer = await createValidJpegBuffer();

    const file = new File([buffer.buffer as ArrayBuffer], 'test.jpg', { type: 'image/jpeg' });
    await expect(uploadMedia('post-1', file)).rejects.toThrow();
  });
});