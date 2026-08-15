import { describe, it, expect, beforeEach } from 'vitest';
import sharp from 'sharp';
import {
  inspectMagicBytes,
  sanitizeAndValidateImage,
  MAX_IMAGE_UPLOAD_BYTES,
  MAX_IMAGE_DIMENSION,
  STANDARDIZED_MAX_WIDTH,
  STANDARDIZED_MAX_HEIGHT,
} from '@/lib/media';
import { ApiError } from '@/lib/rbac';

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

    it('rejects text files claiming to be images', () => {
      const fakeImage = Buffer.from('<html><body>Not an image</body></html>');
      expect(() => inspectMagicBytes(fakeImage)).toThrowError(ApiError);
    });

    it('rejects PDF or executable headers', () => {
      const fakePdf = Buffer.from('%PDF-1.4 binary data here');
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
  });

  describe('Allowed Types Only (JPEG & PNG)', () => {
    it('rejects unsupported declared MIME types like image/gif, image/webp, image/svg+xml', async () => {
      await expect(
        sanitizeAndValidateImage(sampleJpegBuffer, 'image/gif')
      ).rejects.toThrowError('Only JPG and PNG images are allowed.');

      await expect(
        sanitizeAndValidateImage(sampleJpegBuffer, 'image/svg+xml')
      ).rejects.toThrowError('Only JPG and PNG images are allowed.');
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
  });

  describe('Decompression Bomb & Dimension Protections', () => {
    it('rejects images exceeding 10,000 px dimension limits', async () => {
      // Create a mock metadata or oversize buffer scenario
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
      // 3000 x 2000 (aspect ratio 1.5)
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

      // Aspect ratio 1.5 inside 1920x1080: height bound is 1080 -> width is 1080 * 1.5 = 1620
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
});
