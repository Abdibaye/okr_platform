import { emailProvider, escapeHtml, sendEmail } from "./email";

export type DeliveryResult =
  | { status: "sent"; error: null }
  | { status: "in_app_only"; error: null }
  | { status: "failed"; error: string };

/**
 * Sends an invitation email through the configured provider (see server/email.ts). Without a provider
 * the link is logged server-side and the invitation stays usable in-app (admins can copy the link).
 */
export async function sendInvitationEmail({ to, url, companyName, inviterName }: {
  to: string;
  url: string;
  companyName: string;
  inviterName: string;
}): Promise<DeliveryResult> {
  if (!emailProvider()) console.info(`Invitation link for ${to} (${companyName}): ${url}`);
  const result = await sendEmail({
    to,
    subject: `${inviterName} invited you to ${companyName} on OKR Platform`,
    text: `${inviterName} invited you to join ${companyName}. Accept the invitation here (valid for 7 days): ${url}`,
    html: `<p>${escapeHtml(inviterName)} invited you to join <strong>${escapeHtml(companyName)}</strong> on OKR Platform.</p><p><a href="${escapeHtml(url)}">Accept invitation</a></p><p>This link is valid for 7 days.</p>`,
  });
  return result.status === "failed" ? { status: "failed", error: result.error } : { status: result.status, error: null };
}
