import ResetPasswordClient from "./ResetPasswordClient";

export const dynamic = "force-dynamic";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const sp = await searchParams;
  const token = Array.isArray(sp.token) ? (sp.token[0] ?? "") : (sp.token ?? "");
  return <ResetPasswordClient token={token} />;
}
