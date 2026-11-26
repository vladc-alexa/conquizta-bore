import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isError, requireAdmin } from "@/lib/admin";

// DELETE /api/admin/chat/[id] — delete a chat message.
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (isError(auth)) return auth;

  const { id } = await ctx.params;
  const msg = await prisma.chatMessage.findUnique({ where: { id }, select: { id: true } });
  if (!msg) return NextResponse.json({ error: "not found" }, { status: 404 });
  await prisma.chatMessage.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
