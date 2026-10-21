import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/password";
import { signSession, sessionCookie } from "@/lib/session";

// Simple in-memory throttle: max 5 sign-ups per IP per hour. Best-effort
// (resets on deploy, per-replica) — enough to stop scripted spam.
const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_WINDOW = 5;
const hits = new Map<string, number[]>();

function tooManyAttempts(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_PER_WINDOW) {
    hits.set(ip, recent);
    return true;
  }
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) {
    for (const [key, times] of hits) {
      if (!times.some((t) => now - t < WINDOW_MS)) hits.delete(key);
    }
  }
  return false;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const RESERVED = new Set(["test", "test@test.com", "admin", "administrator"]);

// POST /api/auth/register { displayName, email, password }
export async function POST(req: Request) {
  try {
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
      req.headers.get("x-real-ip")?.trim() ||
      "unknown";
    if (tooManyAttempts(ip)) {
      return NextResponse.json(
        { error: "Prea multe conturi create de pe această conexiune. Încearcă mai târziu." },
        { status: 429 }
      );
    }

    const body = await req.json().catch(() => null);
    const displayName = typeof body?.displayName === "string" ? body.displayName.trim() : "";
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body?.password === "string" ? body.password : "";

    if (displayName.length < 3 || displayName.length > 32) {
      return NextResponse.json({ error: "Numele trebuie să aibă între 3 și 32 de caractere." }, { status: 400 });
    }
    if (!/^[\p{L}\p{N} _.\-]+$/u.test(displayName)) {
      return NextResponse.json(
        { error: "Numele poate conține doar litere, cifre, spații, _ . -" },
        { status: 400 }
      );
    }
    if (!EMAIL_RE.test(email) || email.length > 254) {
      return NextResponse.json({ error: "Adresa de email nu e validă." }, { status: 400 });
    }
    if (password.length < 6) {
      return NextResponse.json({ error: "Parola trebuie să aibă minim 6 caractere." }, { status: 400 });
    }
    if (password.length > 200) {
      return NextResponse.json({ error: "Parola e prea lungă." }, { status: 400 });
    }
    if (RESERVED.has(displayName.toLowerCase()) || RESERVED.has(email)) {
      return NextResponse.json({ error: "Numele sau emailul nu poate fi folosit." }, { status: 400 });
    }

    // Case-insensitive name clash check (the DB unique index is case-sensitive).
    const existing = await prisma.user.findFirst({
      where: {
        OR: [{ email }, { displayName: { equals: displayName, mode: "insensitive" } }],
      },
      select: { email: true, displayName: true },
    });
    if (existing) {
      const error =
        existing.email === email
          ? "Există deja un cont cu acest email. Intră în cont."
          : "Numele e deja luat. Alege altul.";
      return NextResponse.json({ error }, { status: 409 });
    }

    const user = await prisma.user.create({
      data: { displayName, email, passwordHash: hashPassword(password) },
      select: { id: true, displayName: true },
    });

    const token = await signSession({
      sub: user.id,
      name: user.displayName,
      exp: Math.floor(Date.now() / 1000) + 30 * 86400,
    });
    return new NextResponse(JSON.stringify({ ok: true, name: user.displayName }), {
      status: 201,
      headers: { "Content-Type": "application/json", "Set-Cookie": sessionCookie(token) },
    });
  } catch (e) {
    // Unique-constraint race between the check above and the insert.
    const code = (e as { code?: string })?.code;
    if (code === "P2002") {
      return NextResponse.json({ error: "Există deja un cont cu acest nume sau email." }, { status: 409 });
    }
    return NextResponse.json({ error: "Eroare internă." }, { status: 500 });
  }
}
