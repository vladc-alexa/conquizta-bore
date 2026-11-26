import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifySession, SESSION_COOKIE } from "@/lib/session";
import { isSiteOff } from "@/lib/siteOff";
import { getClientIp, getIpRule, touchUserIp } from "@/lib/ip";

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
  const user = await prisma.user.findUnique({
    where: { id: session.sub },
    select: { id: true, displayName: true, isAdmin: true, isMuted: true, nameColor: true, hideScore: true, canEditQuestions: true, lastIp: true },
  });
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (ip !== "unknown" && user.lastIp !== ip) {
    await touchUserIp(user.id, ip);
  }
  return NextResponse.json({
    id: user.id,
    name: user.displayName,
    isAdmin: user.isAdmin,
    isMuted: user.isMuted,
    nameColor: user.nameColor,
    hideScore: user.hideScore,
    canEditQuestions: user.canEditQuestions,
    siteOff: await isSiteOff(prisma),
  });
}
