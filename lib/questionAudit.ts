import { prisma } from "@/lib/prisma";

// The admin "who edited this question?" trail.
//
// Every write to a question calls logQuestionEdit(); the row records WHO did it
// (id + a display-name snapshot), WHAT kind of change, and the question text as
// it looked at that moment. Snapshots matter: renaming an editor or deleting a
// question must not blank out the history.
export type EditAction = "create" | "import" | "edit" | "publish" | "unpublish" | "delete";

export type QuestionSnapshot = { prompt: string; options: { text: string; isCorrect: boolean }[] };

// One import can write hundreds of rows for the same editor — cache the name.
const names = new Map<string, string>();

export async function editorName(editorId: string): Promise<string> {
  const hit = names.get(editorId);
  if (hit) return hit;
  const u = await prisma.user.findUnique({ where: { id: editorId }, select: { displayName: true } });
  const name = u?.displayName ?? "?";
  names.set(editorId, name);
  if (names.size > 500) names.clear();
  return name;
}

export async function logQuestionEdit(input: {
  questionId: string | null;
  editorId: string;
  action: EditAction;
  prompt: string;
  summary?: string | null;
}): Promise<void> {
  await logQuestionEdits(input.editorId, [
    { questionId: input.questionId, action: input.action, prompt: input.prompt, summary: input.summary ?? null },
  ]);
}

export async function logQuestionEdits(
  editorId: string,
  rows: { questionId: string | null; action: EditAction; prompt: string; summary?: string | null }[]
): Promise<void> {
  if (rows.length === 0) return;
  try {
    const name = await editorName(editorId);
    await prisma.questionEdit.createMany({
      data: rows.map((r) => ({
        questionId: r.questionId,
        editorId,
        editorName: name,
        action: r.action,
        prompt: r.prompt.slice(0, 1000),
        summary: r.summary?.slice(0, 300) ?? null,
      })),
    });
  } catch (e) {
    // The trail must never break the edit itself.
    console.error("questionEdit log failed", e);
  }
}

// Human-readable "what changed", for the history list.
export function editSummary(before: QuestionSnapshot, after: QuestionSnapshot): string | null {
  const parts: string[] = [];
  if (before.prompt.trim() !== after.prompt.trim()) parts.push("textul");
  const b = before.options.map((o) => o.text.trim());
  const a = after.options.map((o) => o.text.trim());
  if (b.length !== a.length) parts.push("numărul de variante");
  else if (b.some((t, i) => t !== a[i])) parts.push("variantele");
  const bc = before.options.find((o) => o.isCorrect)?.text.trim() ?? null;
  const ac = after.options.find((o) => o.isCorrect)?.text.trim() ?? null;
  if (bc !== ac) parts.push("răspunsul corect");
  return parts.length ? parts.join(" · ") : null;
}
