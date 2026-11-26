import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifySession, SESSION_COOKIE } from "@/lib/session";
import { ONLINE_WINDOW_MS, onlineUsers } from "@/lib/presence";

export const dynamic = "force-dynamic";

// POST /api/presence — heartbeat from an open tab ("I am still here").
// The browser beats every ~45s; a player counts as online for 2 minutes after
// the last beat, so closing the tab drops them off the list on its own.
export async function POST() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const seen = await prisma.user.updateMany({
    where: { id: session.sub },
    data: { lastSeenAt: new Date() },
  });
  if (seen.count === 0) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  return NextResponse.json({ online: (await onlineUsers(prisma)).length, windowMs: ONLINE_WINDOW_MS });
}

// GET /api/presence — the online list on its own (the leaderboard embeds it too).
export async function GET() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const players = await onlineUsers(prisma);
  return NextResponse.json({ online: players.length, players, windowMs: ONLINE_WINDOW_MS });
}
