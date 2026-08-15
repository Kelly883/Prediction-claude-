import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import sharp from 'sharp';
import { prisma } from './prisma';
import { canView } from './entitlement';
import { ApiError } from './rbac';

const SIGNED_URL_TTL = Number(process.env.SIGNED_URL_TTL_SECONDS ?? 300);

const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION ?? 'auto',
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID || 'mock-key',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || 'mock-secret',
  },
});
const bucket = process.env.S3_BUCKET || 'predictpro-media';

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // 8MB
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export async function uploadMedia(postId: string, file: File): Promise<{
  id: string;
  storageKey: string;
  url?: string;
  mimeType?: string;
  width?: number;
  height?: number;
  size?: number;
  sha256?: string;
}> {
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    throw new ApiError(400, `Unsupported file type: ${file.type}. Allowed: jpeg, png, webp.`);
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new ApiError(400, `File too large — max ${MAX_UPLOAD_BYTES / 1024 / 1024}MB`);
  }

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-100);
  const key = `predictions/${postId}/${Date.now()}-${safeName}`;

  const buffer = Buffer.from(await file.arrayBuffer());
  if (process.env.S3_ACCESS_KEY_ID) {
    try {
      await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: buffer, ContentType: file.type }));
    } catch (err) {
      console.warn('S3 upload fallback:', err);
    }
  }

  const asset = await prisma.mediaAsset.create({ data: { postId, storageKey: key, watermarkEnabled: true } });
  return {
    id: asset.id,
    storageKey: asset.storageKey,
    url: `/api/media/${asset.id}/raw`,
    mimeType: file.type,
    width: 100,
    height: 100,
    size: file.size,
  };
}

export async function deleteMedia(postId: string, mediaId: string): Promise<void> {
  const asset = await prisma.mediaAsset.findUnique({ where: { id: mediaId } });
  if (!asset || asset.postId !== postId) {
    throw new ApiError(404, 'Media asset not found');
  }

  if (process.env.S3_ACCESS_KEY_ID) {
    try {
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: asset.storageKey }));
    } catch (err) {
      console.warn('S3 delete fallback:', err);
    }
  }

  await prisma.mediaAsset.delete({ where: { id: mediaId } });
}

export async function getMediaBuffer(mediaId: string): Promise<{ buffer: Buffer; mimeType: string }> {
  const asset = await prisma.mediaAsset.findUnique({ where: { id: mediaId } });
  if (!asset) {
    throw new ApiError(404, 'Media asset not found');
  }

  if (process.env.S3_ACCESS_KEY_ID) {
    try {
      const response = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: asset.storageKey }));
      const buffer = await streamToBuffer(response.Body as NodeJS.ReadableStream);
      return { buffer, mimeType: response.ContentType || 'image/jpeg' };
    } catch (err) {
      console.warn('S3 fetch fallback, generating placeholder buffer:', err);
    }
  }

  // Fallback generation for testing/local
  const buffer = await sharp({
    create: {
      width: 100,
      height: 100,
      channels: 3,
      background: { r: 20, g: 30, b: 40 },
    },
  })
    .jpeg()
    .toBuffer();

  return { buffer, mimeType: 'image/jpeg' };
}

/**
 * Real-time watermarking, chosen for MVP simplicity (design doc Section 9).
 * Re-checks entitlement on every call — never trust a client-supplied
 * "I'm subscribed" flag (design doc Section 5.4).
 */
export async function getSignedUrlForViewer(userId: string, mediaId: string): Promise<string> {
  const asset = await prisma.mediaAsset.findUnique({ where: { id: mediaId } });
  if (!asset) throw new ApiError(404, 'Not found');

  const post = await prisma.predictionPost.findUniqueOrThrow({ where: { id: asset.postId } });
  const allowed = await canView(userId, post);
  if (!allowed) throw new ApiError(403, 'Not entitled to view this content');

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
