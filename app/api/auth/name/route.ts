import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifySession, SESSION_COOKIE } from "@/lib/session";

// POST /api/auth/name { name } — change your own displayName.
export async function POST(req: Request) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 32) {
    return NextResponse.json({ error: "Numele e obligatoriu (max 32 caractere)." }, { status: 400 });
  }

  const taken = await prisma.user.findFirst({ where: { displayName: name, id: { not: session.sub } } });
  if (taken) return NextResponse.json({ error: "Numele e deja luat." }, { status: 409 });

  await prisma.user.update({ where: { id: session.sub }, data: { displayName: name } });
  return NextResponse.json({ ok: true, name });
}
