import { ResetPasswordScreen } from "../reset-password";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const { token, error } = await searchParams;
  return <ResetPasswordScreen token={token ?? null} tokenError={error ?? null} />;
}
