/**
 * Transactional email. Uses Resend when RESEND_API_KEY is set, otherwise POSTs to
 * TRANSACTIONAL_EMAIL_WEBHOOK_URL when set. Without either, messages stay in-app only.
 * All configuration is server-side runtime environment; nothing reaches the browser bundle.
 */

export type EmailResult =
  | { status: "sent"; error?: undefined }
  | { status: "in_app_only"; error?: undefined }
  | { status: "failed"; error: string };

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

const TIMEOUT_MS = 10_000;

export function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);
}

export function emailProvider(): "resend" | "webhook" | null {
  if (process.env.RESEND_API_KEY) return "resend";
  if (process.env.TRANSACTIONAL_EMAIL_WEBHOOK_URL) return "webhook";
  return null;
}

function describeFailure(error: unknown) {
  if (error instanceof Error) {
    if (error.name === "TimeoutError") return "Email provider timed out";
    // fetch reports network problems as "fetch failed" with the real reason (e.g. ECONNREFUSED) in `cause`.
    const cause = error.cause instanceof Error ? ((error.cause as NodeJS.ErrnoException).code ?? error.cause.message) : null;
    return (cause ? `Could not reach the email provider (${cause})` : error.message).slice(0, 500);
  }
  return "Email delivery failed";
}

export async function sendEmail(message: EmailMessage): Promise<EmailResult> {
  const provider = emailProvider();
  if (!provider) return { status: "in_app_only" };
  const html = message.html ?? `<p>${escapeHtml(message.text).replaceAll("\n", "<br>")}</p>`;
  try {
    const response = provider === "resend"
      ? await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: process.env.EMAIL_FROM || "Neander <no-reply@apps.neander.ai>",
          to: [message.to],
          subject: message.subject,
          text: message.text,
          html,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      : await fetch(process.env.TRANSACTIONAL_EMAIL_WEBHOOK_URL!, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: process.env.EMAIL_FROM || null, to: message.to, subject: message.subject, text: message.text, html }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    if (!response.ok) {
      const payload = await response.json().catch(() => null) as { message?: string; error?: string } | null;
      const detail = (payload?.message || payload?.error) ? `: ${payload.message || payload.error}` : ` (${response.status})`;
      return { status: "failed", error: `Email delivery failed${detail}`.slice(0, 500) };
    }
    return { status: "sent" };
  } catch (error) {
    return { status: "failed", error: describeFailure(error) };
  }
}
