import type { PrismaClient } from "@prisma/client";

// "Online" = the tab sent a heartbeat in the last 2 minutes. The beacon beats
// every 45s, so a live player is never more than one beat from the cutoff and a
// closed tab falls off without any server-side cleanup.
export const ONLINE_WINDOW_MS = 2 * 60 * 1000;
export const HEARTBEAT_MS = 45 * 1000;

export type OnlinePlayer = { id: string; name: string; at: string };

// Ordered by most recent beat; capped so a busy evening can't blow up the payload.
export async function onlineUsers(prisma: PrismaClient, take = 60): Promise<OnlinePlayer[]> {
  const cutoff = new Date(Date.now() - ONLINE_WINDOW_MS);
  const rows = await prisma.user.findMany({
    where: { lastSeenAt: { gte: cutoff } },
    select: { id: true, displayName: true, lastSeenAt: true },
    orderBy: { lastSeenAt: "desc" },
    take,
  });
  return rows.map((u) => ({
    id: u.id,
    name: u.displayName,
    at: (u.lastSeenAt ?? new Date()).toISOString(),
  }));
}
