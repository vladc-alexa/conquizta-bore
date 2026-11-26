import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifySession, SESSION_COOKIE } from "@/lib/session";
import { isSiteOff } from "@/lib/siteOff";
import { getClientIp, getIpRule, touchUserIp } from "@/lib/ip";
import { getLeaderboardSnapshot } from "@/lib/leaderboardCache";

export async function GET(req: Request) {
  const ip = getClientIp(req);
  const ipRule = await getIpRule(ip);
  if (ipRule?.isBanned) {
    return NextResponse.json({ error: "banned" }, { status: 403 });
  }
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const selectBase = {
    id: true,
    displayName: true,
    isAdmin: true,
    isMuted: true,
    nameColor: true,
    hideScore: true,
    canEditQuestions: true,
  } as const;

  let user: {
    id: string;
    displayName: string;
    isAdmin: boolean;
    isMuted: boolean;
    nameColor: string | null;
    hideScore: boolean;
    canEditQuestions: boolean;
    lastIp?: string | null;
  } | null = null;

  try {
    user = await prisma.user.findUnique({
      where: { id: session.sub },
      select: { ...selectBase, lastIp: true },
    });
    if (user && ip !== "unknown" && user.lastIp !== ip) {
      await touchUserIp(user.id, ip);
    }
  } catch {
    // Fallback if lastIp column is not yet migrated in DB
    user = await prisma.user.findUnique({
      where: { id: session.sub },
      select: selectBase,
    });
  }

  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let prc: number | null = null;
  let winsAllTime = 0;
  try {
    const snap = await getLeaderboardSnapshot(prisma);
    const mine = snap.prcByUser.get(user.id);
    prc = mine?.total ?? null;
    winsAllTime = mine?.wins ?? 0;
  } catch {
    /* ignore if snapshot unavailable */
  }
  return NextResponse.json({
    id: user.id,
    name: user.displayName,
    isAdmin: user.isAdmin,
    isMuted: user.isMuted,
    nameColor: user.nameColor,
    hideScore: user.hideScore,
    canEditQuestions: user.canEditQuestions,
    prc,
    winsAllTime,
    siteOff: await isSiteOff(prisma),
  });
}
