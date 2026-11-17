import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { getAuth } from "@/server/auth";
import { getDb } from "@/server/db";
import { companies, invitations, user } from "@/server/schema";
import { InviteScreen, type InviteDetails } from "./invite-screen";

export const dynamic = "force-dynamic";

export default async function InvitePage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  let details: InviteDetails | null = null;

  if (token && token.length <= 128) {
    const [row] = await getDb().select({
      email: invitations.email,
      name: invitations.name,
      role: invitations.role,
      status: invitations.status,
      expiresAt: invitations.expiresAt,
      companyName: companies.name,
      inviterName: user.name,
    }).from(invitations)
      .innerJoin(companies, eq(companies.id, invitations.companyId))
      .leftJoin(user, eq(user.id, invitations.invitedBy))
      .where(eq(invitations.token, token))
      .limit(1);
    if (row) {
      const expired = row.status === "expired" || (row.status === "pending" && row.expiresAt <= new Date());
      details = {
        email: row.email,
        name: row.name,
        role: row.role,
        status: expired ? "expired" : row.status,
        companyName: row.companyName,
        inviterName: row.inviterName ?? "A workspace admin",
        expiresAt: row.expiresAt.toISOString(),
      };
    }
  }

  const session = await getAuth().api.getSession({ headers: await headers() }).catch(() => null);
  return <InviteScreen token={token ?? ""} details={details} signedInEmail={session?.user.email ?? null} />;
}
