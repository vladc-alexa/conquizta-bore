import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";

export type TokenKind = "verify" | "reset";

const TTL_MS: Record<TokenKind, number> = {
  verify: 24 * 60 * 60 * 1000, // 24h to click the confirmation link
  reset: 60 * 60 * 1000, // 1h to set a new password
};

/** How many links of one kind may be minted per user per hour. */
export const MAX_TOKENS_PER_HOUR = 5;

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function recentTokenCount(userId: string, kind: TokenKind, windowMs = 60 * 60 * 1000): Promise<number> {
  return prisma.authToken.count({
    where: { userId, kind, createdAt: { gt: new Date(Date.now() - windowMs) } },
  });
}

/** Mints a token, returns the RAW value (only ever sent by email) — the DB keeps the hash. */
export async function issueToken(userId: string, kind: TokenKind): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await prisma.authToken.create({
    data: {
      userId,
      kind,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + TTL_MS[kind]),
    },
  });
  return token;
}

/** Single-use: marks the matching, unexpired, unused token as used and returns its owner. */
export async function consumeToken(token: string, kind: TokenKind): Promise<{ userId: string } | null> {
  if (!token || token.length < 20 || token.length > 200) return null;
  const row = await prisma.authToken.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!row || row.kind !== kind || row.usedAt || row.expiresAt.getTime() <= Date.now()) return null;
  const claimed = await prisma.authToken.updateMany({
    where: { id: row.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (claimed.count !== 1) return null;
  return { userId: row.userId };
}

/** Drops every still-live token of a kind for one user (used after a successful verification/reset). */
export async function revokeTokens(userId: string, kind: TokenKind): Promise<void> {
  await prisma.authToken.deleteMany({ where: { userId, kind, usedAt: null } });
}
