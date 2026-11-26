import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { MAX_TOKENS_PER_HOUR, issueToken, recentTokenCount } from "@/lib/authTokens";
import { getClientIp } from "@/lib/ip";
import { mailConfigured, sendMail } from "@/lib/mailer";
import { verificationEmail } from "@/lib/emailTemplates";

// Best-effort per-IP throttle: resend is the one endpoint that sends mail on demand.
const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_IP = 5;
const hits = new Map<string, number[]>();

function ipThrottled(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_PER_IP) {
    hits.set(ip, recent);
    return true;
  }
  recent.push(now);
  hits.set(ip, recent);
  return false;
}

// POST /api/auth/resend-verification { email }
// Always answers 200 for unknown / already-verified addresses (no account enumeration).
export async function POST(req: Request) {
  try {
    const ip = getClientIp(req);
    const body = await req.json().catch(() => null);
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!email) return NextResponse.json({ ok: true });
    if (ipThrottled(ip)) {
      return NextResponse.json({ ok: true });
    }
    if (!mailConfigured()) {
      return NextResponse.json({ error: "Trimiterea emailurilor nu e configurată." }, { status: 503 });
    }

    const user = await prisma.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
      select: { id: true, displayName: true, email: true, emailVerifiedAt: true },
    });
    if (!user || user.emailVerifiedAt || !user.email) return NextResponse.json({ ok: true });

    if ((await recentTokenCount(user.id, "verify")) >= MAX_TOKENS_PER_HOUR) {
      return NextResponse.json({ ok: true });
    }

    const token = await issueToken(user.id, "verify");
    const mail = verificationEmail(user.displayName, token);
    await sendMail({ to: user.email, ...mail });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[resend-verification]", e);
    return NextResponse.json({ error: "Nu am putut trimite emailul acum. Încearcă mai târziu." }, { status: 503 });
  }
}
