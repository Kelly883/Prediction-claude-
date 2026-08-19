export function verificationEmailHtml(verificationUrl: string): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Verify your PredictPro account</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f4;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f4f4f4;">
    <tr>
      <td align="center" style="padding:40px 20px;">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 4px rgba(0,0,0,0.1);">
          <tr>
            <td style="background-color:#0b2216;padding:32px 40px;text-align:center;">
              <h1 style="margin:0;font-size:24px;color:#ffffff;font-weight:600;">PredictPro</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:40px;">
              <h2 style="margin:0 0 16px;font-size:20px;color:#1a1a1a;font-weight:600;">Verify your email address</h2>
              <p style="margin:0 0 24px;font-size:16px;color:#333333;line-height:1.6;">
                Welcome to PredictPro. Please verify your email address to activate your account and start receiving verified football predictions.
              </p>
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 24px;">
                <tr>
                  <td style="background-color:#0b2216;border-radius:4px;text-align:center;">
                    <a href="${verificationUrl}" style="display:inline-block;padding:14px 32px;font-size:16px;color:#ffffff;text-decoration:none;font-weight:600;">Verify Email Address</a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 8px;font-size:14px;color:#666666;line-height:1.6;">
                If the button doesn't work, copy and paste this link into your browser:
              </p>
              <p style="margin:0 0 24px;font-size:14px;color:#0b2216;word-break:break-all;">
                <a href="${verificationUrl}" style="color:#0b2216;text-decoration:underline;">${verificationUrl}</a>
              </p>
              <p style="margin:0 0 8px;font-size:14px;color:#666666;line-height:1.6;">
                This verification link expires in <strong>24 hours</strong>.
              </p>
              <p style="margin:24px 0 0;font-size:14px;color:#666666;line-height:1.6;">
                If you did not create a PredictPro account, you can safely ignore this email.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 40px;background-color:#f9f9f9;border-top:1px solid #eeeeee;text-align:center;">
              <p style="margin:0;font-size:12px;color:#999999;">
                PredictPro — Verified football predictions
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

export function verificationEmailText(verificationUrl: string): string {
  return `Verify your PredictPro account

Welcome to PredictPro.

Please verify your email address to activate your account and start receiving verified football predictions.

Verify your email: ${verificationUrl}

This verification link expires in 24 hours.

If you did not create a PredictPro account, you can safely ignore this email.

PredictPro — Verified football predictions
`.trim();
}
