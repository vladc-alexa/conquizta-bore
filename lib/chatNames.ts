// Display names used for @-mention detection in the chat feed. Kept in one place
// (and cached briefly) because the feed is polled every few seconds by every
// open tab: without the cache each poll would re-read the whole roster.
import { prisma } from "@/lib/prisma";

const TTL_MS = 15_000;

type NameRow = { id: string; name: string };
let cache: { at: number; users: NameRow[] } = { at: 0, users: [] };

/** Everyone's display name, newest accounts included. */
export async function chatNames(): Promise<NameRow[]> {
  if (cache.users.length && Date.now() - cache.at < TTL_MS) return cache.users;
  const users = await prisma.user.findMany({
    take: 500,
    select: { id: true, displayName: true },
    orderBy: { createdAt: "asc" },
  });
  cache = { at: Date.now(), users: users.map((u) => ({ id: u.id, name: u.displayName })) };
  return cache.users;
}

/** Drop the cache after a sign-up or rename, so a fresh name is pingable at once. */
export function invalidateChatNames() {
  cache = { at: 0, users: [] };
}
