import { verificationEmailHtml, verificationEmailText } from './emails/templates';

export async function sendEmail(params: { to: string; subject: string; html: string; text?: string }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  const appUrl = process.env.APP_URL;

  if (!apiKey || !from) {
    throw new Error('RESEND_API_KEY / RESEND_FROM_EMAIL not configured — cannot send email');
  }
  if (!appUrl) {
    throw new Error('APP_URL is not configured — verification links will be broken');
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to: params.to,
      subject: params.subject,
      html: params.html,
      text: params.text,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend send failed: ${res.status} ${body}`);
  }
}

export async function sendVerificationEmail(to: string, verificationUrl: string) {
  return sendEmail({
    to,
    subject: 'Verify your PredictPro account',
    html: verificationEmailHtml(verificationUrl),
    text: verificationEmailText(verificationUrl),
  });
}
