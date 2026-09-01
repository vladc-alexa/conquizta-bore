import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/password";
import { signSession, sessionCookie } from "@/lib/session";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body?.password === "string" ? body.password : "";
    if (!email || !password) {
      return NextResponse.json({ error: "Email și parola sunt obligatorii." }, { status: 400 });
    }
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user?.passwordHash || !verifyPassword(password, user.passwordHash)) {
      return NextResponse.json({ error: "Email sau parolă incorecte." }, { status: 401 });
    }
    const token = await signSession({
      sub: user.id,
      name: user.displayName,
      exp: Math.floor(Date.now() / 1000) + 30 * 86400,
    });
    return new NextResponse(JSON.stringify({ ok: true, name: user.displayName }), {
      status: 200,
      headers: { "Content-Type": "application/json", "Set-Cookie": sessionCookie(token) },
    });
  } catch {
    return NextResponse.json({ error: "Eroare internă." }, { status: 500 });
  }
}
