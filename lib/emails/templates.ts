export function baseEmailWrap(title: string, eyebrow: string, bodyHtml: string, ctaHtml: string, footerText?: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background-color:#0f2b1d;font-family:Inter,system-ui,sans-serif;-webkit-font-smoothing:antialiased;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#0f2b1d;">
    <tr>
      <td align="center" style="padding:40px 20px;">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="background-color:#17392a;border-radius:12px;overflow:hidden;border:1px solid rgba(243,245,236,0.1);">
          <tr>
            <td style="background-color:#0f2b1d;padding:32px 40px;text-align:center;border-bottom:1px solid rgba(243,245,236,0.1);">
              <h1 style="margin:0;font-size:24px;color:#e8a33d;font-weight:700;font-family:Space Grotesk,system-ui,sans-serif;">PredictPro</h1>
              <p style="margin:6px 0 0;font-size:12px;color:#9fb3a6;letter-spacing:0.08em;text-transform:uppercase;">${eyebrow}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:40px;">
              ${bodyHtml}
              ${ctaHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:24px 40px;background-color:#0f2b1d;border-top:1px solid rgba(243,245,236,0.08);text-align:center;">
              <p style="margin:0;font-size:12px;color:#9fb3a6;">
                ${footerText || 'PredictPro — Verified football predictions'}
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`.trim();
}

export function baseTextEmail(eyebrow: string, body: string, footerText?: string): string {
  return `${eyebrow}

${body}

${footerText || 'PredictPro — Verified football predictions'}`.trim();
}

export function verificationEmailHtml(verificationUrl: string): string {
  const bodyHtml = `
              <h2 style="margin:0 0 16px;font-size:22px;color:#f3f5ec;font-weight:700;font-family:Space Grotesk,system-ui,sans-serif;">Verify your email address</h2>
              <p style="margin:0 0 24px;font-size:15px;color:#9fb3a6;line-height:1.7;">
                Welcome to PredictPro. Please verify your email address to activate your account and start receiving verified football predictions.
              </p>`;
  const ctaHtml = `
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 24px;">
                <tr>
                  <td style="background-color:#e8a33d;border-radius:8px;text-align:center;">
                    <a href="${verificationUrl}" style="display:inline-block;padding:14px 32px;font-size:15px;color:#0f2b1d;text-decoration:none;font-weight:700;font-family:Inter,system-ui,sans-serif;">Verify Email Address</a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 8px;font-size:13px;color:#9fb3a6;line-height:1.6;">
                If the button doesn't work, copy and paste this link into your browser:
              </p>
              <p style="margin:0 0 24px;font-size:13px;color:#e8a33d;word-break:break-all;">
                <a href="${verificationUrl}" style="color:#e8a33d;text-decoration:underline;">${verificationUrl}</a>
              </p>
              <p style="margin:0 0 8px;font-size:13px;color:#9fb3a6;line-height:1.6;">
                This verification link expires in <strong style="color:#f3f5ec;">24 hours</strong>.
              </p>
              <p style="margin:24px 0 0;font-size:13px;color:#9fb3a6;line-height:1.6;">
                If you did not create a PredictPro account, you can safely ignore this email.
              </p>`;
  return baseEmailWrap('Verify your PredictPro account', 'Account Activation', bodyHtml, ctaHtml);
}

export function verificationEmailText(verificationUrl: string): string {
  return baseTextEmail(
    'Account Activation',
    `Welcome to PredictPro.

Please verify your email address to activate your account and start receiving verified football predictions.

Verify your email: ${verificationUrl}

This verification link expires in 24 hours.

If you did not create a PredictPro account, you can safely ignore this email.`
  );
}

export function passwordResetEmailHtml(resetUrl: string, ttlMinutes: number = 30): string {
  const bodyHtml = `
              <h2 style="margin:0 0 16px;font-size:22px;color:#f3f5ec;font-weight:700;font-family:Space Grotesk,system-ui,sans-serif;">Reset your password</h2>
              <p style="margin:0 0 24px;font-size:15px;color:#9fb3a6;line-height:1.7;">
                We received a request to reset your PredictPro password. Click the button below to choose a new one. This link expires in ${ttlMinutes} minutes.
              </p>`;
  const ctaHtml = `
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 24px;">
                <tr>
                  <td style="background-color:#e8a33d;border-radius:8px;text-align:center;">
                    <a href="${resetUrl}" style="display:inline-block;padding:14px 32px;font-size:15px;color:#0f2b1d;text-decoration:none;font-weight:700;font-family:Inter,system-ui,sans-serif;">Reset Password</a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 8px;font-size:13px;color:#9fb3a6;line-height:1.6;">
                If the button doesn't work, copy and paste this link into your browser:
              </p>
              <p style="margin:0 0 24px;font-size:13px;color:#e8a33d;word-break:break-all;">
                <a href="${resetUrl}" style="color:#e8a33d;text-decoration:underline;">${resetUrl}</a>
              </p>
              <p style="margin:24px 0 0;font-size:13px;color:#9fb3a6;line-height:1.6;">
                If you did not request a password reset, you can safely ignore this email. Your password will not change.
              </p>`;
  return baseEmailWrap('Reset your PredictPro password', 'Account Recovery', bodyHtml, ctaHtml);
}

export function passwordResetEmailText(resetUrl: string, ttlMinutes: number = 30): string {
  return baseTextEmail(
    'Account Recovery',
    `We received a request to reset your PredictPro password.

Reset your password: ${resetUrl}

This link expires in ${ttlMinutes} minutes.

If you did not request a password reset, you can safely ignore this email. Your password will not change.`
  );
}

export function renewalReminderEmailHtml(renewalUrl: string, planName: string, endDate: string): string {
  const bodyHtml = `
              <h2 style="margin:0 0 16px;font-size:22px;color:#f3f5ec;font-weight:700;font-family:Space Grotesk,system-ui,sans-serif;">Your plan is expiring soon</h2>
              <p style="margin:0 0 24px;font-size:15px;color:#9fb3a6;line-height:1.7;">
                Your <strong style="color:#f3f5ec;">${planName}</strong> ends on <strong style="color:#f3f5ec;">${endDate}</strong>. We don't have a payment method on file to renew it automatically, so your access will end unless you renew manually.
              </p>`;
  const ctaHtml = `
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 24px;">
                <tr>
                  <td style="background-color:#e8a33d;border-radius:8px;text-align:center;">
                    <a href="${renewalUrl}" style="display:inline-block;padding:14px 32px;font-size:15px;color:#0f2b1d;text-decoration:none;font-weight:700;font-family:Inter,system-ui,sans-serif;">Renew Your Plan</a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 8px;font-size:13px;color:#9fb3a6;line-height:1.6;">
                Need help? Reply to this email or contact our support team.
              </p>`;
  return baseEmailWrap('Your PredictPro plan is expiring soon', 'Subscription', bodyHtml, ctaHtml);
}

export function renewalReminderEmailText(renewalUrl: string, planName: string, endDate: string): string {
  return baseTextEmail(
    'Subscription',
    `Your ${planName} ends on ${endDate}. We don't have a payment method on file to renew it automatically.

Renew manually before then to keep access: ${renewalUrl}

Need help? Reply to this email or contact our support team.`
  );
}

export function adminVerificationEmailHtml(verificationUrl: string): string {
  const bodyHtml = `
              <h2 style="margin:0 0 16px;font-size:22px;color:#f3f5ec;font-weight:700;font-family:Space Grotesk,system-ui,sans-serif;">Verify your email address</h2>
              <p style="margin:0 0 24px;font-size:15px;color:#9fb3a6;line-height:1.7;">
                Our support team requested a new verification link for your account. Click the button below to verify your email address. This link expires in 24 hours.
              </p>`;
  const ctaHtml = `
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 24px;">
                <tr>
                  <td style="background-color:#e8a33d;border-radius:8px;text-align:center;">
                    <a href="${verificationUrl}" style="display:inline-block;padding:14px 32px;font-size:15px;color:#0f2b1d;text-decoration:none;font-weight:700;font-family:Inter,system-ui,sans-serif;">Verify Email Address</a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 8px;font-size:13px;color:#9fb3a6;line-height:1.6;">
                If the button doesn't work, copy and paste this link into your browser:
              </p>
              <p style="margin:0 0 24px;font-size:13px;color:#e8a33d;word-break:break-all;">
                <a href="${verificationUrl}" style="color:#e8a33d;text-decoration:underline;">${verificationUrl}</a>
              </p>
              <p style="margin:24px 0 0;font-size:13px;color:#9fb3a6;line-height:1.6;">
                If you did not request this verification email, you can safely ignore it.
              </p>`;
  return baseEmailWrap('Verify your PredictPro account', 'Account Activation', bodyHtml, ctaHtml);
}

export function adminVerificationEmailText(verificationUrl: string): string {
  return baseTextEmail(
    'Account Activation',
    `Our support team requested a new verification link for your PredictPro account.

Verify your email: ${verificationUrl}

This link expires in 24 hours.

If you did not request this verification email, you can safely ignore it.`
  );
}
