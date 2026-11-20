import { prisma } from "@/lib/prisma";

// Question triage.
//
// Quarantine = "out of rotation, needs a human". It is orthogonal to the plain
// publish flag: a quarantined row is also unpublished, so every game query that
// already filters isPublished=true skips it with no extra work. Restoring puts
// it straight back into rotation.
//
// Reasons:
//   unvetted     — never answered by anyone (40% of the pool at the time this
//                  landed); nobody has proven the answer is right.
//   low-accuracy — answered >= 8 times with <= 15% correct: likely a wrong key,
//                  an ambiguous prompt, or an impossible question.
//   reported     — a player reported it (the report route unpublishes it too).

export type QuarantineReason = "unvetted" | "low-accuracy" | "reported";

export const QUARANTINE_REASON: Record<QuarantineReason, string> = {
  unvetted: "nejucată încă",
  "low-accuracy": "prea grea / greșită",
  reported: "raportată",
};

export const quarantineLabel = (reason: string | null | undefined): string =>
  (reason && QUARANTINE_REASON[reason as QuarantineReason]) || "în carantină";

export async function quarantineQuestions(
  ids: string[],
  reason: QuarantineReason
): Promise<number> {
  if (ids.length === 0) return 0;
  const res = await prisma.question.updateMany({
    where: { id: { in: ids } },
    data: { isPublished: false, quarantinedAt: new Date(), quarantineReason: reason },
  });
  return res.count;
}

export async function restoreQuestion(id: string): Promise<void> {
  await prisma.question.update({
    where: { id },
    data: { isPublished: true, quarantinedAt: null, quarantineReason: null },
  });
}

// The two automatic rules, as counts and as ids. Kept here so the CLI script and
// the admin API agree on the definition.
export async function autoTriageCandidates(): Promise<{
  unvetted: string[];
  lowAccuracy: string[];
}> {
  const [unvetted, lowAccuracy] = await Promise.all([
    prisma.$queryRaw<{ id: string }[]>`
      SELECT q.id FROM "Question" q
      WHERE q."isPublished" = true
        AND q."quarantinedAt" IS NULL
        AND NOT EXISTS (SELECT 1 FROM "SessionAnswer" a WHERE a."questionId" = q.id)`,
    prisma.$queryRaw<{ id: string }[]>`
      SELECT q.id FROM "Question" q
      WHERE q."isPublished" = true
        AND q."quarantinedAt" IS NULL
        AND (SELECT count(*) FROM "SessionAnswer" a WHERE a."questionId" = q.id) >= 8
        AND (SELECT count(*) FROM "SessionAnswer" a WHERE a."questionId" = q.id AND a."isCorrect")::float
            / NULLIF((SELECT count(*) FROM "SessionAnswer" a WHERE a."questionId" = q.id), 0) <= 0.15`,
  ]);
  return { unvetted: unvetted.map((r) => r.id), lowAccuracy: lowAccuracy.map((r) => r.id) };
}
