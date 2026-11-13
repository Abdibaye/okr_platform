export type DeliveryResult =
  | { status: "sent"; error: null }
  | { status: "in_app_only"; error: null }
  | { status: "failed"; error: string };

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);
}

/**
 * Sends an invitation email through Resend when RESEND_API_KEY is set. Without a provider the
 * link is logged server-side and the invitation stays usable in-app (admins can copy the link).
 */
export async function sendInvitationEmail({ to, url, companyName, inviterName }: {
  to: string;
  url: string;
  companyName: string;
  inviterName: string;
}): Promise<DeliveryResult> {
  if (!process.env.RESEND_API_KEY) {
    console.info(`Invitation link for ${to} (${companyName}): ${url}`);
    return { status: "in_app_only", error: null };
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM || "OKR Platform <onboarding@resend.dev>",
        to: [to],
        subject: `${inviterName} invited you to ${companyName} on OKR Platform`,
        text: `${inviterName} invited you to join ${companyName}. Accept the invitation here (valid for 7 days): ${url}`,
        html: `<p>${escapeHtml(inviterName)} invited you to join <strong>${escapeHtml(companyName)}</strong> on OKR Platform.</p><p><a href="${escapeHtml(url)}">Accept invitation</a></p><p>This link is valid for 7 days.</p>`,
      }),
    });
    if (!response.ok) return { status: "failed", error: `Email delivery failed (${response.status})` };
    return { status: "sent", error: null };
  } catch (error) {
    return { status: "failed", error: error instanceof Error ? error.message.slice(0, 500) : "Email delivery failed" };
  }
}
