import crypto from 'crypto';
import {
  verificationEmailHtml,
  verificationEmailText,
  passwordResetEmailHtml,
  passwordResetEmailText,
  renewalReminderEmailHtml,
  renewalReminderEmailText,
  adminVerificationEmailHtml,
  adminVerificationEmailText,
} from './emails/templates';

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  listUnsubscribe?: string;
  senderName?: string;
}

export async function sendEmail(params: SendEmailOptions) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  const appUrl = process.env.APP_URL;

  if (!apiKey || !from) {
    throw new Error('RESEND_API_KEY / RESEND_FROM_EMAIL not configured — cannot send email');
  }
  if (!appUrl) {
    throw new Error('APP_URL is not configured — verification links will be broken');
  }

  const senderName = params.senderName || 'PredictPro';
  const fromAddress = from.includes('<') ? from : `${senderName} <${from}>`;
  const messageId = `<${crypto.randomUUID()}@${new URL(appUrl).hostname}>`;

  const headers: Record<string, string> = {
    'Message-ID': messageId,
    'X-Mailer': 'PredictPro/1.0',
  };

  if (params.listUnsubscribe) {
    headers['List-Unsubscribe'] = `<${params.listUnsubscribe}>`;
    headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
  }

  const payload: Record<string, unknown> = {
    from: fromAddress,
    to: params.to,
    subject: params.subject,
    html: params.html,
    text: params.text,
    headers,
  };

  if (params.replyTo) {
    payload.replyTo = params.replyTo;
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const resBody = await res.json().catch(() => null);

  if (!res.ok) {
    const bodyText = typeof resBody === 'string' ? resBody : JSON.stringify(resBody);
    const reason = resBody && typeof resBody === 'object' && 'message' in (resBody as any)
      ? (resBody as any).message
      : bodyText;
    const hint = res.status === 422
      ? ' Check that RESEND_FROM_EMAIL domain is verified in Resend and has SPF/DKIM records.'
      : '';
    throw new Error(`Resend send failed: ${res.status} ${reason || bodyText}${hint}`);
  }

  console.log(`[email] Sent to=${params.to} subject="${params.subject}" id=${(resBody as any)?.id} from=${fromAddress}`);
  return resBody;
}

export function getReplyTo(): string {
  const from = process.env.RESEND_FROM_EMAIL || '';
  const match = from.match(/<(.+?)>/) || from.match(/(.+)/);
  return match ? match[1] : 'support@predictpro.cloud-ip.cc';
}

export async function sendVerificationEmail(to: string, verificationUrl: string) {
  return sendEmail({
    to,
    subject: 'Verify your PredictPro account',
    html: verificationEmailHtml(verificationUrl),
    text: verificationEmailText(verificationUrl),
    listUnsubscribe: `${process.env.APP_URL}/unsubscribe?email=${encodeURIComponent(to)}`,
    replyTo: getReplyTo(),
  });
}

export async function sendPasswordResetEmail(to: string, resetUrl: string, ttlMinutes: number = 30) {
  return sendEmail({
    to,
    subject: 'Reset your PredictPro password',
    html: passwordResetEmailHtml(resetUrl, ttlMinutes),
    text: passwordResetEmailText(resetUrl, ttlMinutes),
    listUnsubscribe: `${process.env.APP_URL}/unsubscribe?email=${encodeURIComponent(to)}`,
    replyTo: getReplyTo(),
  });
}

export async function sendRenewalReminderEmail(
  to: string,
  renewalUrl: string,
  planName: string,
  endDate: string,
) {
  return sendEmail({
    to,
    subject: 'Your PredictPro plan is expiring soon',
    html: renewalReminderEmailHtml(renewalUrl, planName, endDate),
    text: renewalReminderEmailText(renewalUrl, planName, endDate),
    listUnsubscribe: `${process.env.APP_URL}/unsubscribe?email=${encodeURIComponent(to)}`,
    replyTo: getReplyTo(),
  });
}

export async function sendAdminVerificationEmail(to: string, verificationUrl: string) {
  return sendEmail({
    to,
    subject: 'Verify your PredictPro account',
    html: adminVerificationEmailHtml(verificationUrl),
    text: adminVerificationEmailText(verificationUrl),
    listUnsubscribe: `${process.env.APP_URL}/unsubscribe?email=${encodeURIComponent(to)}`,
    replyTo: getReplyTo(),
  });
}
