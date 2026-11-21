import { escapeHtml } from "./email.ts";

interface ResetPasswordEmailInput {
  url: string;
  name?: string | null;
  email: string;
}

export function buildResetPasswordEmail({ url, name, email }: ResetPasswordEmailInput) {
  const displayName = name?.trim();
  const greeting = displayName ? `Hi ${displayName},` : "Hi there,";
  const body = `We received a request to reset the password for this Alineo account (${email}). If this was you, use the button below to choose a new password.`;
  const subject = "Reset your Alineo password";
  const text = [
    greeting,
    "",
    `We received a request to reset the password for this Alineo account (${email}). If this was you, open the link below to choose a new password.`,
    "",
    "Reset your password:",
    url,
    "",
    "This link can only be used once. If it no longer works, you can request a new one from the sign-in screen.",
    "",
    "If you didn't request this reset, you can safely ignore this email — your password will not change.",
    "",
    "Alineo · Strategic OKR Platform",
    "This is an automated message about a password reset request.",
  ].join("\n");
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(subject)}</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f1f5f9;color:#0f172a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;line-height:1.6;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f1f5f9;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="width:480px;max-width:100%;background-color:#ffffff;border-radius:12px;border:1px solid #e2e8f0;">
            <tr>
              <td style="padding:32px 40px 40px;">
                <p style="margin:0 0 28px;font-size:18px;font-weight:700;letter-spacing:-0.02em;color:#0f172a;">Alineo</p>
                <h1 style="margin:0 0 16px;font-size:24px;line-height:1.3;color:#0f172a;">Reset your password</h1>
                <p style="margin:0 0 8px;font-size:15px;color:#0f172a;">${escapeHtml(greeting)}</p>
                <p style="margin:0 0 28px;font-size:15px;color:#0f172a;">${escapeHtml(body)}</p>
                <p style="margin:0 0 28px;text-align:center;">
                  <a href="${escapeHtml(url)}" style="display:inline-block;background-color:#2563eb;color:#ffffff;font-weight:700;font-size:15px;text-decoration:none;padding:10px 20px;border-radius:8px;">Reset password</a>
                </p>
                <p style="margin:0 0 8px;font-size:14px;font-weight:600;color:#0f172a;">Or paste this link into your browser:</p>
                <p style="margin:0 0 28px;font-size:14px;color:#475569;word-break:break-all;">${escapeHtml(url)}</p>
                <p style="margin:0 0 24px;font-size:14px;color:#475569;">This link can only be used once. If it no longer works, you can request a new one from the sign-in screen.</p>
                <p style="margin:0 0 28px;font-size:14px;color:#475569;">If you didn't request this reset, you can safely ignore this email — your password will not change.</p>
                <p style="margin:0 0 8px;padding-top:24px;border-top:1px solid #e2e8f0;font-size:14px;font-weight:600;color:#475569;">Alineo · Strategic OKR Platform</p>
                <p style="margin:0;font-size:13px;color:#475569;">This is an automated message about a password reset request.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject, text, html };
}
