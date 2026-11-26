import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { MAX_TOKENS_PER_HOUR, issueToken, recentTokenCount } from "@/lib/authTokens";
import { getClientIp } from "@/lib/ip";
import { mailConfigured, sendMail } from "@/lib/mailer";
import { passwordResetEmail } from "@/lib/emailTemplates";

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

// POST /api/auth/forgot-password { email }
// Answers 200 whether or not the account exists.
export async function POST(req: Request) {
  try {
    const ip = getClientIp(req);
    const body = await req.json().catch(() => null);
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!email) return NextResponse.json({ ok: true });
    if (ipThrottled(ip)) return NextResponse.json({ ok: true });
    if (!mailConfigured()) return NextResponse.json({ ok: true });

    const user = await prisma.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
      select: { id: true, displayName: true, email: true },
    });
    if (!user?.email) return NextResponse.json({ ok: true });
    if ((await recentTokenCount(user.id, "reset")) >= MAX_TOKENS_PER_HOUR) {
      return NextResponse.json({ ok: true });
    }

    const token = await issueToken(user.id, "reset");
    const mail = passwordResetEmail(user.displayName, token);
    await sendMail({ to: user.email, ...mail });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[forgot-password]", e);
    // never reveal whether the address exists — a mail outage is reported generically
    return NextResponse.json({ ok: true });
  }
}
