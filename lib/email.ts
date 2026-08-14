// Minimal Resend integration via plain fetch — no SDK dependency needed for
// a single "send this transactional email" call. Requires RESEND_API_KEY
// and RESEND_FROM_EMAIL (a verified sender on your Resend account) to
// actually send; without them this throws loudly rather than silently
// dropping the email, so a misconfigured deploy fails fast and visibly
// instead of just quietly never sending reset emails.
export async function sendEmail(params: { to: string; subject: string; html: string }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from) {
    throw new Error('RESEND_API_KEY / RESEND_FROM_EMAIL not configured — cannot send email');
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: params.to, subject: params.subject, html: params.html }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend send failed: ${res.status} ${body}`);
  }
}
