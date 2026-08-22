import crypto from 'crypto';
import { prisma } from './prisma';
import { PaymentProvider, WebhookProcessingStatus } from '@prisma/client';

const MAX_WEBHOOK_RETRIES = 3;

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
  const event = await prisma.webhookEvent.findUnique({ where: { id } });
  if (!event) return;

  const newRetryCount = (event.retryCount ?? 0) + 1;
  const shouldDeadLetter = newRetryCount >= MAX_WEBHOOK_RETRIES;

  await prisma.webhookEvent.update({
    where: { id },
    data: {
      status: shouldDeadLetter ? 'deadLettered' : 'failed',
      failedAt: new Date(),
      deadLetteredAt: shouldDeadLetter ? new Date() : undefined,
      errorMessage,
      retryCount: newRetryCount,
    },
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

export async function getDeadLetteredWebhookEvents(limit = 50): Promise<any[]> {
  return prisma.webhookEvent.findMany({
    where: { status: 'deadLettered' },
    orderBy: { receivedAt: 'asc' },
    take: limit,
  });
}

export async function retryWebhookEvent(id: string): Promise<any> {
  const event = await prisma.webhookEvent.findUnique({ where: { id } });
  if (!event) throw new Error('Webhook event not found');

  if (event.status !== 'failed' && event.status !== 'deadLettered') {
    throw new Error(`Cannot retry webhook event with status: ${event.status}`);
  }

  return prisma.webhookEvent.update({
    where: { id },
    data: {
      status: 'received',
      processingStartedAt: null,
      processedAt: null,
      failedAt: null,
      deadLetteredAt: null,
      errorMessage: null,
      retryCount: 0,
    },
  });
}
