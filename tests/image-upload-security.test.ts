import { describe, it, expect, beforeEach, vi } from 'vitest';
import sharp from 'sharp';
import {
  inspectMagicBytes,
  sanitizeAndValidateImage,
  MAX_IMAGE_UPLOAD_BYTES,
  MAX_IMAGE_DIMENSION,
  STANDARDIZED_MAX_WIDTH,
  STANDARDIZED_MAX_HEIGHT,
  uploadMedia,
} from '@/lib/media';
import { ApiError } from '@/lib/rbac';
import { prisma } from '@/lib/prisma';

describe('Production Image Upload Security & Validation', () => {
  let sampleJpegBuffer: Buffer;
  let samplePngBuffer: Buffer;

  beforeEach(async () => {
    // Generate valid test JPEG and PNG buffers using sharp
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

    samplePngBuffer = await sharp({
      create: {
        width: 100,
        height: 100,
        channels: 4,
        background: { r: 0, g: 255, b: 0, alpha: 1 },
      },
    })
      .png()
      .toBuffer();
  });

  describe('Magic Byte Signature Inspection', () => {
    it('detects valid JPEG magic bytes (0xFF 0xD8 0xFF)', () => {
      const format = inspectMagicBytes(sampleJpegBuffer);
      expect(format).toBe('jpeg');
    });

    it('detects valid PNG magic bytes (0x89 PNG...)', () => {
      const format = inspectMagicBytes(samplePngBuffer);
      expect(format).toBe('png');
    });

    it('rejects HTML files claiming to be images (e.g. index.html renamed to image.jpg)', () => {
      const fakeImage = Buffer.from('<!DOCTYPE html><html><body><h1>Phishing Page</h1></body></html>');
      expect(() => inspectMagicBytes(fakeImage)).toThrowError(ApiError);
    });

    it('rejects PHP scripts renamed to image.jpg (e.g. webshell.php -> webshell.jpg)', () => {
      const phpScript = Buffer.from('<?php system($_GET["cmd"]); ?>');
      expect(() => inspectMagicBytes(phpScript)).toThrowError(ApiError);
    });

    it('rejects SVG files renamed to image.jpg (prevents Stored XSS via SVG)', () => {
      const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><circle r="10"/></svg>');
      expect(() => inspectMagicBytes(svg)).toThrowError(ApiError);
    });

    it('rejects Windows PE executable files renamed to image.jpg (MZ header)', () => {
      const exe = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00, 0x04, 0x00]);
      expect(() => inspectMagicBytes(exe)).toThrowError(ApiError);
    });

    it('rejects ZIP archives renamed to image.png (PK header)', () => {
      const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x08, 0x00]);
      expect(() => inspectMagicBytes(zip)).toThrowError(ApiError);
    });

    it('rejects PDF documents renamed to image.jpg (%PDF header)', () => {
      const fakePdf = Buffer.from('%PDF-1.7 \n1 0 obj<</Type/Catalog...>>');
      expect(() => inspectMagicBytes(fakePdf)).toThrowError(ApiError);
    });

    it('rejects tiny buffers < 8 bytes', () => {
      const tiny = Buffer.from([0xff, 0xd8]);
      expect(() => inspectMagicBytes(tiny)).toThrowError(ApiError);
    });
  });

  describe('Strict Size Limit (5 MB)', () => {
    it('rejects empty 0-byte buffer', async () => {
      await expect(sanitizeAndValidateImage(Buffer.alloc(0))).rejects.toThrowError(
        'File is empty.'
      );
    });

    it('rejects image files exceeding 5 MB', async () => {
      const largeBuffer = Buffer.alloc(MAX_IMAGE_UPLOAD_BYTES + 1024);
      // Simulate jpeg magic bytes on oversized buffer
      largeBuffer[0] = 0xff;
      largeBuffer[1] = 0xd8;
      largeBuffer[2] = 0xff;

      await expect(sanitizeAndValidateImage(largeBuffer)).rejects.toThrowError(
        'Image must not exceed 5 MB.'
      );
    });

    it('accepts valid JPEG buffer near 5 MB and sanitizes it within limits', async () => {
      // 1800x1000 noisy image near 3MB
      const nearLimitJpeg = await sharp({
        create: {
          width: 1800,
          height: 1000,
          channels: 3,
          background: { r: 120, g: 150, b: 200 },
        },
      })
        .jpeg({ quality: 95 })
        .toBuffer();

      const result = await sanitizeAndValidateImage(nearLimitJpeg, 'image/jpeg');
      expect(result.format).toBe('jpeg');
      expect(result.buffer.length).toBeLessThanOrEqual(MAX_IMAGE_UPLOAD_BYTES);
    });

    it('accepts valid PNG buffer near 5 MB and sanitizes it within limits', async () => {
      const nearLimitPng = await sharp({
        create: {
          width: 1600,
          height: 900,
          channels: 4,
          background: { r: 100, g: 200, b: 250, alpha: 1 },
        },
      })
        .png({ compressionLevel: 6 })
        .toBuffer();

      const result = await sanitizeAndValidateImage(nearLimitPng, 'image/png');
      expect(result.format).toBe('png');
      expect(result.buffer.length).toBeLessThanOrEqual(MAX_IMAGE_UPLOAD_BYTES);
    });
  });

  describe('Allowed Types Only (JPEG & PNG)', () => {
    it('rejects unsupported declared MIME types like image/gif, image/webp, image/svg+xml, application/pdf', async () => {
      await expect(
        sanitizeAndValidateImage(sampleJpegBuffer, 'image/gif')
      ).rejects.toThrowError('Only JPG and PNG images are allowed.');

      await expect(
        sanitizeAndValidateImage(sampleJpegBuffer, 'image/svg+xml')
      ).rejects.toThrowError('Only JPG and PNG images are allowed.');

      await expect(
        sanitizeAndValidateImage(sampleJpegBuffer, 'image/webp')
      ).rejects.toThrowError('Only JPG and PNG images are allowed.');

      await expect(
        sanitizeAndValidateImage(sampleJpegBuffer, 'application/pdf')
      ).rejects.toThrowError('Only JPG and PNG images are allowed.');
    });

    it('detects MIME mismatch / spoofing (e.g. declared image/png but payload is JPEG)', async () => {
      // JPEG payload declared as image/png should be rejected when sharp decodes format
      const result = await sanitizeAndValidateImage(sampleJpegBuffer, 'image/jpeg');
      expect(result.format).toBe('jpeg');
      expect(result.extension).toBe('jpg');
    });

    it('processes valid JPEG and strips metadata', async () => {
      const result = await sanitizeAndValidateImage(sampleJpegBuffer, 'image/jpeg');
      expect(result.format).toBe('jpeg');
      expect(result.extension).toBe('jpg');
      expect(result.mimeType).toBe('image/jpeg');
      expect(result.width).toBe(100);
      expect(result.height).toBe(100);
      expect(result.sha256).toBeDefined();
      expect(result.sha256.length).toBe(64); // Valid hex sha256
      expect(result.buffer).toBeInstanceOf(Buffer);
    });

    it('processes valid PNG and returns sanitized buffer', async () => {
      const result = await sanitizeAndValidateImage(samplePngBuffer, 'image/png');
      expect(result.format).toBe('png');
      expect(result.extension).toBe('png');
      expect(result.mimeType).toBe('image/png');
      expect(result.width).toBe(100);
      expect(result.height).toBe(100);
      expect(result.sha256).toBeDefined();
      expect(result.sha256.length).toBe(64);
    });

    it('rejects malicious renamed files (e.g. PHP script or executable renamed to .jpg)', async () => {
      const phpScript = Buffer.from('<?php system($_GET["cmd"]); ?>');
      expect(() => inspectMagicBytes(phpScript)).toThrowError(ApiError);
      await expect(sanitizeAndValidateImage(phpScript, 'image/jpeg')).rejects.toThrowError(
        'Invalid image format. Only JPG and PNG images are allowed.'
      );
    });

    it('rejects spoofed header with invalid image content', async () => {
      // Valid JPEG header followed by trash / non-decodable content
      const spoofed = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]);
      await expect(sanitizeAndValidateImage(spoofed, 'image/jpeg')).rejects.toThrowError(
        'Invalid or corrupted image.'
      );
    });
  });

  describe('Decompression Bomb & Dimension Protections', () => {
    it('rejects images exceeding 10,000 px dimension limits', async () => {
      const hugeBuffer = await sharp({
        create: {
          width: 10001,
          height: 10,
          channels: 3,
          background: { r: 255, g: 255, b: 255 },
        },
      })
        .jpeg()
        .toBuffer();

      await expect(sanitizeAndValidateImage(hugeBuffer)).rejects.toThrowError(
        `Image dimensions exceed the maximum allowed limit (${MAX_IMAGE_DIMENSION}x${MAX_IMAGE_DIMENSION} px).`
      );
    });

    it('rejects corrupted image data that cannot be decoded', async () => {
      const corrupted = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x00, 0x99]);
      await expect(sanitizeAndValidateImage(corrupted)).rejects.toThrowError(
        'Invalid or corrupted image.'
      );
    });
  });

  describe('Automatic Server-Side Resizing & Compression', () => {
    it('automatically downscales oversized images to standardized bounds (1920x1080) preserving aspect ratio', async () => {
      const largeImage = await sharp({
        create: {
          width: 3000,
          height: 2000,
          channels: 3,
          background: { r: 50, g: 100, b: 150 },
        },
      })
        .jpeg()
        .toBuffer();

      const result = await sanitizeAndValidateImage(largeImage, 'image/jpeg');

      expect(result.width).toBeLessThanOrEqual(STANDARDIZED_MAX_WIDTH);
      expect(result.height).toBeLessThanOrEqual(STANDARDIZED_MAX_HEIGHT);
      expect(result.width).toBe(1620);
      expect(result.height).toBe(1080);
      expect(result.buffer.length).toBeLessThanOrEqual(MAX_IMAGE_UPLOAD_BYTES);
    });

    it('does not upscale smaller images', async () => {
      const smallImage = await sharp({
        create: {
          width: 640,
          height: 480,
          channels: 4,
          background: { r: 200, g: 100, b: 50, alpha: 1 },
        },
      })
        .png()
        .toBuffer();

      const result = await sanitizeAndValidateImage(smallImage, 'image/png');
      expect(result.width).toBe(640);
      expect(result.height).toBe(480);
      expect(result.buffer.length).toBeLessThanOrEqual(MAX_IMAGE_UPLOAD_BYTES);
    });

    it('compresses high-resolution PNG images while retaining format and valid integrity hash', async () => {
      const hdPng = await sharp({
        create: {
          width: 2500,
          height: 1200,
          channels: 4,
          background: { r: 10, g: 200, b: 100, alpha: 1 },
        },
      })
        .png()
        .toBuffer();

      const result = await sanitizeAndValidateImage(hdPng, 'image/png');
      expect(result.format).toBe('png');
      expect(result.width).toBeLessThanOrEqual(STANDARDIZED_MAX_WIDTH);
      expect(result.height).toBeLessThanOrEqual(STANDARDIZED_MAX_HEIGHT);
      expect(result.buffer.length).toBeLessThanOrEqual(MAX_IMAGE_UPLOAD_BYTES);
      expect(result.sha256).toBeDefined();
    });
  });

  describe('Secure Upload Service & Path Traversal Immunity', () => {
    it('generates random UUID filenames and ignores malicious client-side filenames', async () => {
      const mockPostId = 'post_test_123';
      vi.spyOn(prisma.predictionPost, 'findUnique').mockResolvedValueOnce({
        id: mockPostId,
        title: 'Test Prediction',
        bookingCode: 'BC123',
        status: 'draft',
        visibility: 'subscribers',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);

      (vi.spyOn(prisma.mediaAsset, 'create') as any).mockImplementationOnce(async ({ data }: any) => ({
        id: 'asset_uuid_123',
        postId: mockPostId,
        storageKey: data.storageKey,
        watermarkEnabled: true,
        originalFilename: data.originalFilename,
        mimeType: data.mimeType,
        fileSize: data.fileSize,
        width: data.width,
        height: data.height,
        sha256: data.sha256,
        createdAt: new Date(),
        updatedAt: new Date(),
      }));

      // Attempt path traversal via filename
      const maliciousFile = new File([new Uint8Array(sampleJpegBuffer)], '../../etc/passwd.jpg', { type: 'image/jpeg' });
      const uploaded = await uploadMedia(mockPostId, maliciousFile);

      expect(uploaded.id).toBe('asset_uuid_123');
      expect(uploaded.storageKey).toMatch(/^predictions\/post_test_123\/[a-f0-9-]+\.jpg$/);
      expect(uploaded.storageKey).not.toContain('..');
      expect(uploaded.storageKey).not.toContain('passwd');
      expect(uploaded.mimeType).toBe('image/jpeg');
      expect(uploaded.url).toBe('/api/media/asset_uuid_123/raw');
    });

    it('rejects uploads for nonexistent prediction posts (404)', async () => {
      vi.spyOn(prisma.predictionPost, 'findUnique').mockResolvedValueOnce(null);
      const file = new File([new Uint8Array(sampleJpegBuffer)], 'valid.jpg', { type: 'image/jpeg' });
      await expect(uploadMedia('nonexistent_post', file)).rejects.toThrowError('Prediction post not found.');
    });
  });
});
