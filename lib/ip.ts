import { prisma } from "@/lib/prisma";

export interface IpRuleState {
  ip: string;
  isBanned: boolean;
  isMuted: boolean;
  reason?: string | null;
}

const g = globalThis as unknown as { __stoneIpRules?: Map<string, IpRuleState> };
const memRules = (g.__stoneIpRules ??= new Map<string, IpRuleState>());

export function getClientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first.slice(0, 64);
  }
  const cf = req.headers.get("cf-connecting-ip")?.trim();
  if (cf) return cf.slice(0, 64);
  const realIp = req.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp.slice(0, 64);
  return "unknown";
}

export async function getIpRule(ip: string): Promise<IpRuleState | null> {
  if (!ip || ip === "unknown") return null;
  try {
    const row = await prisma.ipRule.findUnique({ where: { ip } });
    if (row) {
      return { ip: row.ip, isBanned: row.isBanned, isMuted: row.isMuted, reason: row.reason };
    }
    return null;
  } catch {
    return memRules.get(ip) ?? null;
  }
}

export async function listIpRules(): Promise<IpRuleState[]> {
  try {
    const rows = await prisma.ipRule.findMany({
      where: { OR: [{ isBanned: true }, { isMuted: true }] },
      orderBy: { updatedAt: "desc" },
    });
    return rows.map((r) => ({ ip: r.ip, isBanned: r.isBanned, isMuted: r.isMuted, reason: r.reason }));
  } catch {
    return [...memRules.values()].filter((r) => r.isBanned || r.isMuted);
  }
}

export async function setIpRule(
  ip: string,
  patch: Partial<Pick<IpRuleState, "isBanned" | "isMuted" | "reason">>
): Promise<IpRuleState> {
  const cleanIp = ip.trim().slice(0, 64);
  try {
    const existing = await prisma.ipRule.findUnique({ where: { ip: cleanIp } });
    const nextBanned = patch.isBanned ?? existing?.isBanned ?? false;
    const nextMuted = patch.isMuted ?? existing?.isMuted ?? false;
    const nextReason = patch.reason !== undefined ? patch.reason : (existing?.reason ?? null);
    const row = await prisma.ipRule.upsert({
      where: { ip: cleanIp },
      create: { ip: cleanIp, isBanned: nextBanned, isMuted: nextMuted, reason: nextReason },
      update: { isBanned: nextBanned, isMuted: nextMuted, reason: nextReason },
    });
    const state = { ip: row.ip, isBanned: row.isBanned, isMuted: row.isMuted, reason: row.reason };
    memRules.set(cleanIp, state);
    return state;
  } catch {
    const existing = memRules.get(cleanIp);
    const state: IpRuleState = {
      ip: cleanIp,
      isBanned: patch.isBanned ?? existing?.isBanned ?? false,
      isMuted: patch.isMuted ?? existing?.isMuted ?? false,
      reason: patch.reason !== undefined ? patch.reason : (existing?.reason ?? null),
    };
    memRules.set(cleanIp, state);
    return state;
  }
}

export async function touchUserIp(userId: string, ip: string): Promise<void> {
  if (!userId || !ip || ip === "unknown") return;
  try {
    await prisma.user.updateMany({
      where: { id: userId },
      data: { lastIp: ip },
    });
  } catch {
    /* ignore in offline/no-DB mode */
  }
}
