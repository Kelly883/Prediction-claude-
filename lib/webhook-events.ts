import crypto from 'crypto';
import { prisma } from './prisma';
import { PaymentProvider, WebhookProcessingStatus } from '@prisma/client';

export function computeWebhookEventId(
  provider: PaymentProvider,
  eventType: string,
  providerReference: string | null | undefined,
  payload: any,
): string {
  const identitySource = `${provider}:${eventType}:${providerReference ?? 'none'}`;
  const content = JSON.stringify(payload ?? {});
  return crypto.createHash('sha256').update(identitySource + content).digest('hex');
}

export async function persistWebhookEvent(params: {
  provider: PaymentProvider;
  providerEventId: string;
  providerReference?: string | null;
  eventType: string;
  payload: any;
}): Promise<any> {
  const payloadHash = computeWebhookEventId(params.provider, params.eventType, params.providerReference, params.payload);
  const payloadSize = JSON.stringify(params.payload).length;
  const storedPayload = payloadSize > 64 * 1024 ? { error: 'Payload exceeded maximum size limit', size: payloadSize } : params.payload;

  try {
    return await prisma.webhookEvent.create({
      data: {
        provider: params.provider,
        providerEventId: params.providerEventId,
        providerReference: params.providerReference ?? null,
        eventType: params.eventType,
        payloadHash,
        payload: storedPayload,
        status: 'received',
      },
    });
  } catch (err: any) {
    if (err?.code === 'P2002') {
      return await prisma.webhookEvent.findFirst({
        where: {
          provider: params.provider,
          providerEventId: params.providerEventId,
        },
      });
    }
    throw err;
  }
}

export async function markWebhookProcessing(id: string): Promise<void> {
  await prisma.webhookEvent.updateMany({
    where: { id, status: 'received' },
    data: { status: 'processing', processingStartedAt: new Date() },
  });
}

export async function markWebhookProcessed(id: string): Promise<void> {
  await prisma.webhookEvent.update({
    where: { id },
    data: { status: 'processed', processedAt: new Date() },
  });
}

export async function markWebhookFailed(id: string, errorMessage: string): Promise<void> {
  await prisma.webhookEvent.update({
    where: { id },
    data: { status: 'failed', failedAt: new Date(), errorMessage, retryCount: { increment: 1 } },
  });
}

export async function markWebhookIgnored(id: string): Promise<void> {
  await prisma.webhookEvent.update({
    where: { id },
    data: { status: 'ignored', processedAt: new Date() },
  });
}

export async function getFailedWebhookEvents(limit = 50): Promise<any[]> {
  return prisma.webhookEvent.findMany({
    where: { status: 'failed' },
    orderBy: { receivedAt: 'asc' },
    take: limit,
  });
}
