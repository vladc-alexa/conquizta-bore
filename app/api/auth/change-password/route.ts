import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifySession, SESSION_COOKIE } from "@/lib/session";
import { hashPassword, verifyPassword } from "@/lib/password";

// POST /api/auth/change-password { currentPassword, newPassword }
export async function POST(req: Request) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const currentPassword = typeof body?.currentPassword === "string" ? body.currentPassword : "";
  const newPassword = typeof body?.newPassword === "string" ? body.newPassword : "";

  if (!currentPassword || newPassword.length < 4) {
    return NextResponse.json({ error: "Parola nouă trebuie să aibă minim 4 caractere." }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { id: session.sub }, select: { passwordHash: true } });
  if (!user?.passwordHash || !verifyPassword(currentPassword, user.passwordHash)) {
    return NextResponse.json({ error: "Parola actuală e incorectă." }, { status: 400 });
  }

  await prisma.user.update({ where: { id: session.sub }, data: { passwordHash: hashPassword(newPassword) } });
  return NextResponse.json({ ok: true });
}
