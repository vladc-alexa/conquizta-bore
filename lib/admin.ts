import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifySession, SESSION_COOKIE } from "@/lib/session";

// Shared admin guard: returns the user id or a NextResponse error.
export async function requireAdmin(): Promise<{ id: string } | NextResponse> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const user = await prisma.user.findUnique({ where: { id: session.sub }, select: { isAdmin: true } });
  if (!user?.isAdmin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  return { id: session.sub };
}

export function isError(x: { id: string } | NextResponse): x is NextResponse {
  return x instanceof NextResponse;
}
