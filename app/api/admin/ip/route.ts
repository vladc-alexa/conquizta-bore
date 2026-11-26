import { NextResponse } from "next/server";
import { isError, requireAdmin } from "@/lib/admin";
import { listIpRules, setIpRule } from "@/lib/ip";

export async function GET() {
  const auth = await requireAdmin();
  if (isError(auth)) return auth;
  const rules = await listIpRules();
  return NextResponse.json({ rules });
}

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (isError(auth)) return auth;

  const body = await req.json().catch(() => null);
  const ip = typeof body?.ip === "string" ? body.ip.trim() : "";
  const action = typeof body?.action === "string" ? body.action : "";
  const reason = typeof body?.reason === "string" ? body.reason.trim().slice(0, 200) : undefined;

  if (!ip || ip === "unknown" || ip.length > 64) {
    return NextResponse.json({ error: "Adresă IP invalidă." }, { status: 400 });
  }

  let patch: { isBanned?: boolean; isMuted?: boolean; reason?: string | null };
  if (action === "ban") patch = { isBanned: true, ...(reason !== undefined ? { reason } : {}) };
  else if (action === "unban") patch = { isBanned: false };
  else if (action === "mute") patch = { isMuted: true, ...(reason !== undefined ? { reason } : {}) };
  else if (action === "unmute") patch = { isMuted: false };
  else return NextResponse.json({ error: "Acțiune invalidă." }, { status: 400 });

  const rule = await setIpRule(ip, patch);
  return NextResponse.json({ rule });
}
