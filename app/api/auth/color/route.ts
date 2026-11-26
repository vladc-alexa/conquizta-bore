import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifySession, SESSION_COOKIE } from "@/lib/session";
import { ALLOWED_CHAT_COLORS } from "@/lib/chatColors";

// POST /api/auth/color { color } — set the chat name color (whitelisted).
export async function POST(req: Request) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const color = typeof body?.color === "string" ? body.color.toLowerCase() : "";
  if (!ALLOWED_CHAT_COLORS.has(color)) {
    return NextResponse.json({ error: "Culoare nepermisă." }, { status: 400 });
  }
  await prisma.user.update({ where: { id: session.sub }, data: { nameColor: color } });
  return NextResponse.json({ ok: true, color });
}
