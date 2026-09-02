import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isError, requireAdmin } from "@/lib/admin";

// POST /api/admin/users/[id]/name { name } — rename any player (admin-only;
// also lets the admin rename their own account from the player list).
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (isError(auth)) return auth;

  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 32) {
    return NextResponse.json({ error: "Numele e obligatoriu (max 32 caractere)." }, { status: 400 });
  }

  const target = await prisma.user.findUnique({ where: { id }, select: { id: true } });
  if (!target) return NextResponse.json({ error: "Jucătorul nu există." }, { status: 404 });

  const taken = await prisma.user.findFirst({ where: { displayName: name, id: { not: id } } });
  if (taken) return NextResponse.json({ error: "Numele e deja luat." }, { status: 409 });

  await prisma.user.update({ where: { id }, data: { displayName: name } });
  return NextResponse.json({ ok: true, name });
}
