import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { consumeToken, revokeTokens } from "@/lib/authTokens";
import { hashPassword } from "@/lib/password";
import { signSession, sessionCookie } from "@/lib/session";

// POST /api/auth/reset-password { token, password }
// The link also proves the mailbox, so an unverified account becomes active here.
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const token = typeof body?.token === "string" ? body.token.trim() : "";
    const password = typeof body?.password === "string" ? body.password : "";
    if (!token) return NextResponse.json({ error: "Link incomplet." }, { status: 400 });
    if (password.length < 6) {
      return NextResponse.json({ error: "Parola trebuie să aibă minim 6 caractere." }, { status: 400 });
    }
    if (password.length > 200) {
      return NextResponse.json({ error: "Parola e prea lungă." }, { status: 400 });
    }

    const claim = await consumeToken(token, "reset");
    if (!claim) {
      return NextResponse.json(
        { error: "Link invalid sau expirat. Cere un link nou de resetare." },
        { status: 400 }
      );
    }

    const user = await prisma.user.update({
      where: { id: claim.userId },
      data: { passwordHash: hashPassword(password), emailVerifiedAt: new Date() },
      select: { id: true, displayName: true },
    });
    await revokeTokens(user.id, "reset");

    const session = await signSession({
      sub: user.id,
      name: user.displayName,
      exp: Math.floor(Date.now() / 1000) + 30 * 86400,
    });
    return new NextResponse(JSON.stringify({ ok: true, name: user.displayName }), {
      status: 200,
      headers: { "Content-Type": "application/json", "Set-Cookie": sessionCookie(session) },
    });
  } catch (e) {
    console.error("[reset-password]", e);
    return NextResponse.json({ error: "Link invalid sau expirat." }, { status: 400 });
  }
}
