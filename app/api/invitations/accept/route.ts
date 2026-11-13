import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { errorResponse, normalizeEmail, readJson } from "@/server/api-utils";
import { getAuth } from "@/server/auth";
import { getDb } from "@/server/db";
import { acceptInvitation } from "@/server/people";
import { invitations } from "@/server/schema";

export async function POST(request: Request) {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) return errorResponse("Sign in to accept this invitation.", 401);

  const body = await readJson(request);
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  if (!token || token.length > 128) return errorResponse("Invitation not found.", 404);

  const outcome = await getDb().transaction(async (transaction) => {
    const [invitation] = await transaction.select().from(invitations)
      .where(eq(invitations.token, token)).limit(1).for("update");
    if (!invitation) return { error: "Invitation not found.", status: 404 } as const;
    if (normalizeEmail(session.user.email) !== invitation.email) {
      return { error: `This invitation was sent to ${invitation.email}. Sign in with that email to accept it.`, status: 403 } as const;
    }
    if (invitation.status === "accepted") {
      return invitation.acceptedBy === session.user.id
        ? { companyId: invitation.companyId } as const
        : { error: "This invitation has already been used.", status: 409 } as const;
    }
    if (invitation.status === "revoked") return { error: "This invitation was revoked. Ask your admin for a new one.", status: 410 } as const;
    if (invitation.status === "expired" || invitation.expiresAt <= new Date()) {
      if (invitation.status !== "expired") {
        await transaction.update(invitations).set({ status: "expired" }).where(eq(invitations.id, invitation.id));
      }
      return { error: "This invitation has expired. Ask your admin to resend it.", status: 410 } as const;
    }
    await acceptInvitation(transaction, invitation, session.user.id);
    return { companyId: invitation.companyId } as const;
  });

  if ("error" in outcome) return errorResponse(outcome.error, outcome.status);
  return NextResponse.json({ accepted: true, companyId: outcome.companyId });
}
