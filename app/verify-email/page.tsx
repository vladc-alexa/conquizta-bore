import VerifyEmailClient from "./VerifyEmailClient";

export const dynamic = "force-dynamic";

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const sp = await searchParams;
  const token = Array.isArray(sp.token) ? (sp.token[0] ?? "") : (sp.token ?? "");
  return <VerifyEmailClient token={token} />;
}
