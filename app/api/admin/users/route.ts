import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifySession, SESSION_COOKIE } from "@/lib/session";
import { hashPassword } from "@/lib/password";

async function requireAdmin(): Promise<{ id: string } | NextResponse> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const user = await prisma.user.findUnique({ where: { id: session.sub }, select: { isAdmin: true } });
  if (!user?.isAdmin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  return { id: session.sub };
}

export async function GET() {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;
  const users = await prisma.user.findMany({
    orderBy: { createdAt: "asc" },
    select: { id: true, displayName: true, email: true, isAdmin: true, isMuted: true, hideScore: true, createdAt: true },
  });
  return NextResponse.json({ users });
}

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  const body = await req.json().catch(() => null);
  const displayName = typeof body?.displayName === "string" ? body.displayName.trim() : "";
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";

  if (!displayName || displayName.length > 32) {
    return NextResponse.json({ error: "Numele e obligatoriu (max 32 caractere)." }, { status: 400 });
  }
  if (!password || password.length < 4) {
    return NextResponse.json({ error: "Parola trebuie să aibă minim 4 caractere." }, { status: 400 });
  }

  const existing = await prisma.user.findFirst({
    where: {
      OR: [
        { displayName },
        ...(email ? [{ email }] : []),
      ],
    },
  });
  if (existing) {
    return NextResponse.json({ error: "Există deja un jucător cu acest nume/email." }, { status: 409 });
  }

  const user = await prisma.user.create({
    data: { displayName, email: email || null, passwordHash: hashPassword(password) },
    select: { id: true, displayName: true, email: true, isAdmin: true, createdAt: true },
  });
  return NextResponse.json({ user }, { status: 201 });
}

export async function DELETE(req: Request) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  if (id === auth.id) return NextResponse.json({ error: "Nu te poți șterge pe tine." }, { status: 400 });

  const target = await prisma.user.findUnique({ where: { id }, select: { id: true, isAdmin: true } });
  if (!target) return NextResponse.json({ error: "Jucătorul nu există." }, { status: 404 });
  if (target.isAdmin) return NextResponse.json({ error: "Nu poți șterge un admin." }, { status: 400 });

  await prisma.user.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
