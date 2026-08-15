import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import sharp, { type Metadata, type PngOptions } from 'sharp';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { prisma } from './prisma';
import { canView } from './entitlement';
import { ApiError } from './rbac';

const SIGNED_URL_TTL = Number(process.env.SIGNED_URL_TTL_SECONDS ?? 300);

export const MAX_IMAGE_UPLOAD_BYTES = 5 * 1024 * 1024; // Strict 5 MB limit
export const MAX_IMAGE_DIMENSION = 10000; // 10,000 px max input width / height safeguard
export const MAX_IMAGE_TOTAL_PIXELS = 50_000_000; // 50 Megapixels max decompression limit

// Standardized responsive uniform dimensions for prediction slips / charts / graphics
export const STANDARDIZED_MAX_WIDTH = 1920;
export const STANDARDIZED_MAX_HEIGHT = 1080;

const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png']);

const hasS3Config = !!(process.env.S3_BUCKET && process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY);

const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION ?? 'auto',
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID || 'local',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || 'local',
  },
});
const bucket = process.env.S3_BUCKET || '';

const LOCAL_STORAGE_DIR = path.join(process.cwd(), 'storage');

/**
 * Validates binary signature / magic bytes of untrusted image buffer.
 * Rejects any file that does not match JPEG or PNG magic bytes.
 */
export function inspectMagicBytes(buffer: Buffer): 'jpeg' | 'png' {
  if (buffer.length < 8) {
    throw new ApiError(400, 'File is corrupted or too small to be a valid image.');
  }

  // JPEG magic bytes: 0xFF 0xD8 0xFF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'jpeg';
  }

  // PNG magic bytes: 0x89 0x50 0x4E 0x47 0x0D 0x0A 0x1A 0x0A (\x89PNG\r\n\x1a\n)
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'png';
  }

  throw new ApiError(400, 'Invalid image format. Only JPG and PNG images are allowed.');
}

export interface SanitizedImageResult {
  buffer: Buffer;
  format: 'jpeg' | 'png';
  extension: 'jpg' | 'png';
  mimeType: 'image/jpeg' | 'image/png';
  width: number;
  height: number;
  sha256: string;
}

/**
 * Decodes, validates dimensions, strips metadata (EXIF/GPS/comments),
 * and re-encodes untrusted image binary into a clean sanitized buffer.
 */
export async function sanitizeAndValidateImage(rawBuffer: Buffer, declaredType?: string): Promise<SanitizedImageResult> {
  // 1. Strict size check
  if (!rawBuffer || rawBuffer.length === 0) {
    throw new ApiError(400, 'File is empty.');
  }
  if (rawBuffer.length > MAX_IMAGE_UPLOAD_BYTES) {
    throw new ApiError(400, 'Image must not exceed 5 MB.');
  }

  // 2. MIME type check if provided
  if (declaredType && !ALLOWED_MIME_TYPES.has(declaredType.toLowerCase())) {
    throw new ApiError(400, 'Only JPG and PNG images are allowed.');
  }

  // 3. Binary signature / Magic byte validation
  const detectedFormat = inspectMagicBytes(rawBuffer);

  // 4. Decode with sharp + decompression bomb protections
  let metadata: Metadata;
  try {
    const pipeline = sharp(rawBuffer, {
      failOn: 'error',
      limitInputPixels: MAX_IMAGE_TOTAL_PIXELS,
    });
    metadata = await pipeline.metadata();
  } catch (err) {
    console.error('Image decoding failed:', err);
    throw new ApiError(400, 'Invalid or corrupted image.');
  }

  // 5. Verify format from decoder matches signature and allowed formats
  if (metadata.format !== detectedFormat) {
    throw new ApiError(400, 'Image format mismatch detected.');
  }

  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (width <= 0 || height <= 0) {
    throw new ApiError(400, 'Invalid image dimensions.');
  }

  if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION || width * height > MAX_IMAGE_TOTAL_PIXELS) {
    throw new ApiError(400, `Image dimensions exceed the maximum allowed limit (${MAX_IMAGE_DIMENSION}x${MAX_IMAGE_DIMENSION} px).`);
  }

  // 6. Automatic resizing to standardized uniform responsive dimensions & compression
  let sanitizedBuffer: Buffer;
  let finalWidth = width;
  let finalHeight = height;

  try {
    const buildPipeline = (quality: number = 82, pngColors: number = 0) => {
      let pipeline = sharp(rawBuffer, {
        limitInputPixels: MAX_IMAGE_TOTAL_PIXELS,
        failOn: 'error',
      })
        .rotate() // Auto-orient based on EXIF before stripping
        .resize({
          width: STANDARDIZED_MAX_WIDTH,
          height: STANDARDIZED_MAX_HEIGHT,
          fit: 'inside',
          withoutEnlargement: true,
        });

      if (detectedFormat === 'jpeg') {
        return pipeline.jpeg({
          quality,
          mozjpeg: true,
          progressive: true,
        });
      } else {
        const pngOpts: PngOptions = {
          compressionLevel: 9,
          adaptiveFiltering: true,
          progressive: true,
        };
        if (pngColors > 0) {
          pngOpts.palette = true;
          pngOpts.colours = pngColors;
        }
        return pipeline.png(pngOpts);
      }
    };

    // Initial optimized compression
    let quality = 82;
    sanitizedBuffer = await buildPipeline(quality).toBuffer();

    // If buffer still exceeds strict 5MB limit, progressively compress until compliant
    if (sanitizedBuffer.length > MAX_IMAGE_UPLOAD_BYTES) {
      if (detectedFormat === 'jpeg') {
        while (sanitizedBuffer.length > MAX_IMAGE_UPLOAD_BYTES && quality > 20) {
          quality -= 15;
          sanitizedBuffer = await buildPipeline(quality).toBuffer();
        }
      } else {
        // For PNG, apply palette quantization if oversized
        const colorSteps = [256, 192, 128, 64];
        for (const colors of colorSteps) {
          if (sanitizedBuffer.length <= MAX_IMAGE_UPLOAD_BYTES) break;
          sanitizedBuffer = await buildPipeline(quality, colors).toBuffer();
        }
      }
    }

    if (sanitizedBuffer.length > MAX_IMAGE_UPLOAD_BYTES) {
      throw new ApiError(400, 'Image cannot be compressed below 5 MB.');
    }

    // Extract standardized dimensions from the final sanitized output
    const finalMeta = await sharp(sanitizedBuffer).metadata();
    finalWidth = finalMeta.width ?? width;
    finalHeight = finalMeta.height ?? height;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    console.error('Image processing/compression failed:', err);
    throw new ApiError(400, 'Failed to process image.');
  }

  // 7. Calculate SHA-256 hash of the sanitized stored file
  const sha256 = crypto.createHash('sha256').update(sanitizedBuffer).digest('hex');

  return {
    buffer: sanitizedBuffer,
    format: detectedFormat,
    extension: detectedFormat === 'jpeg' ? 'jpg' : 'png',
    mimeType: detectedFormat === 'jpeg' ? 'image/jpeg' : 'image/png',
    width: finalWidth,
    height: finalHeight,
    sha256,
  };
}

/**
 * Saves binary buffer to S3 or local storage
 */
async function saveToStorage(key: string, buffer: Buffer, mimeType: string): Promise<void> {
  if (hasS3Config) {
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: buffer,
        ContentType: mimeType,
      })
    );
  } else {
    const filePath = path.join(LOCAL_STORAGE_DIR, key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, buffer);
  }
}

/**
 * Removes file from storage
 */
async function removeFromStorage(key: string): Promise<void> {
  try {
    if (hasS3Config) {
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    } else {
      const filePath = path.join(LOCAL_STORAGE_DIR, key);
      await fs.unlink(filePath).catch(() => {});
    }
  } catch (err) {
    console.error('Failed to remove from storage:', err);
  }
}

export interface UploadMediaResult {
  id: string;
  postId: string;
  storageKey: string;
  mimeType: string;
  width: number;
  height: number;
  size: number;
  sha256: string;
}

/**
 * Uploads a prediction image with full production-ready security validation.
 */
export async function uploadMedia(postId: string, file: File): Promise<UploadMediaResult> {
  // Ensure the prediction post exists first
  const post = await prisma.predictionPost.findUnique({ where: { id: postId } });
  if (!post) {
    throw new ApiError(404, 'Prediction post not found.');
  }

  const rawBuffer = Buffer.from(await file.arrayBuffer());
  const sanitized = await sanitizeAndValidateImage(rawBuffer, file.type);

  // Generate cryptographically random storage filename to prevent path traversal
  const randomFileName = `${crypto.randomUUID()}.${sanitized.extension}`;
  const key = `predictions/${postId}/${randomFileName}`;

  // 1. Store sanitized file
  await saveToStorage(key, sanitized.buffer, sanitized.mimeType);

  // 2. Atomically create database record; cleanup file if DB operation fails
  try {
    const asset = await prisma.mediaAsset.create({
      data: {
        postId,
        storageKey: key,
        watermarkEnabled: true,
      },
    });

    return {
      id: asset.id,
      postId: asset.postId,
      storageKey: asset.storageKey,
      mimeType: sanitized.mimeType,
      width: sanitized.width,
      height: sanitized.height,
      size: sanitized.buffer.length,
      sha256: sanitized.sha256,
    };
  } catch (dbErr) {
    await removeFromStorage(key);
    throw dbErr;
  }
}

/**
 * Deletes a prediction image from both database and storage.
 */
export async function deleteMedia(postId: string, mediaId: string): Promise<void> {
  const asset = await prisma.mediaAsset.findFirst({
    where: { id: mediaId, postId },
  });

  if (!asset) {
    throw new ApiError(404, 'Image not found for this prediction post.');
  }

  await removeFromStorage(asset.storageKey);
  await prisma.mediaAsset.delete({ where: { id: mediaId } });
}

/**
 * Retrieves signed URL or streaming access for viewer with access control and watermarking.
 */
export async function getSignedUrlForViewer(userId: string, mediaId: string): Promise<string> {
  const asset = await prisma.mediaAsset.findUnique({ where: { id: mediaId } });
  if (!asset) throw new ApiError(404, 'Not found');

  const post = await prisma.predictionPost.findUniqueOrThrow({ where: { id: asset.postId } });
  const allowed = await canView(userId, post);
  if (!allowed) throw new ApiError(403, 'Not entitled to view this content');

  if (!hasS3Config) {
    // In local development or fallback mode, return a direct authenticated API proxy URL
    return `/api/media/${asset.id}/raw`;
  }

  if (!asset.watermarkEnabled) {
    return getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: asset.storageKey }), {
      expiresIn: SIGNED_URL_TTL,
    });
  }

  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const watermarkedKey = await buildWatermarkedCopy(asset.storageKey, user.email);
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: watermarkedKey }), {
    expiresIn: SIGNED_URL_TTL,
  });
}

/**
 * Retrieves raw image buffer for authenticated proxy serving
 */
export async function getMediaBuffer(mediaId: string): Promise<{ buffer: Buffer; mimeType: string }> {
  const asset = await prisma.mediaAsset.findUnique({ where: { id: mediaId } });
  if (!asset) throw new ApiError(404, 'Not found');

  if (hasS3Config) {
    const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: asset.storageKey }));
    const buffer = await streamToBuffer(res.Body as NodeJS.ReadableStream);
    const mimeType = asset.storageKey.endsWith('.png') ? 'image/png' : 'image/jpeg';
    return { buffer, mimeType };
  } else {
    const filePath = path.join(LOCAL_STORAGE_DIR, asset.storageKey);
    const buffer = await fs.readFile(filePath);
    const mimeType = asset.storageKey.endsWith('.png') ? 'image/png' : 'image/jpeg';
    return { buffer, mimeType };
  }
}

async function buildWatermarkedCopy(sourceKey: string, watermarkText: string): Promise<string> {
  const original = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: sourceKey }));
  const buffer = await streamToBuffer(original.Body as NodeJS.ReadableStream);

  const svg = `<svg><text x="10" y="30" font-size="18" fill="white" fill-opacity="0.7">${escapeXml(
    watermarkText,
  )}</text></svg>`;

  const watermarked = await sharp(buffer)
    .composite([{ input: Buffer.from(svg), gravity: 'southeast' }])
    .toBuffer();

  const destKey = `scratch/${sourceKey.replace(/\//g, '_')}-${Date.now()}.jpg`;
  await s3.send(new PutObjectCommand({ Bucket: bucket, Key: destKey, Body: watermarked, ContentType: 'image/jpeg' }));
  return destKey;
}

function escapeXml(input: string) {
  return input.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]!));
}

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

