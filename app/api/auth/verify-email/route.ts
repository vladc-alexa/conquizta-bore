import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { consumeToken, revokeTokens } from "@/lib/authTokens";
import { signSession, sessionCookie } from "@/lib/session";

export const dynamic = "force-dynamic";

// POST /api/auth/verify-email { token }  → confirms the mailbox and signs the player in.
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const token = typeof body?.token === "string" ? body.token.trim() : "";
    if (!token) return NextResponse.json({ error: "Link incomplet." }, { status: 400 });

    const claim = await consumeToken(token, "verify");
    if (!claim) {
      return NextResponse.json(
        { error: "Link invalid sau expirat. Cere unul nou din pagina de login." },
        { status: 400 }
      );
    }

    const user = await prisma.user.update({
      where: { id: claim.userId },
      data: { emailVerifiedAt: new Date() },
      select: { id: true, displayName: true },
    });
    await revokeTokens(user.id, "verify");

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
    console.error("[verify-email]", e);
    return NextResponse.json({ error: "Link invalid sau expirat." }, { status: 400 });
  }
}
