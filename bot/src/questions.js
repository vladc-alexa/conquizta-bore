'use strict';
// Question selection. Uses the SAME SQL filters as the site (app/api/questions/route.ts):
//   grila  = published, exactly 4 options, exactly 1 marked correct
//   rapide = published, correct option text is a plain integer (optional minus)
// Options are shuffled and only {index, text, isCorrect} leaves this module;
// the public payload built by the engine carries indices only (never ids).

function shuffle(a) {
  const b = a.slice();
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}

async function pullGrila(prisma, count) {
  const ids = await prisma.$queryRaw`
    SELECT q.id FROM "Question" q
    WHERE q."isPublished" = true
      AND (SELECT count(*) FROM "QuestionOption" o WHERE o."questionId" = q.id) = 4
      AND (SELECT count(*) FROM "QuestionOption" o WHERE o."questionId" = q.id AND o."isCorrect" = true) = 1
    ORDER BY random()
    LIMIT ${count}`;
  if (!ids.length) return [];
  const rows = await prisma.question.findMany({
    where: { id: { in: ids.map((r) => r.id) } },
    select: { id: true, prompt: true, options: { select: { id: true, text: true, isCorrect: true } } },
  });
  return rows.map((q) => {
    const opts = shuffle(q.options).map((o) => ({ id: o.id, text: o.text, isCorrect: o.isCorrect }));
    return {
      id: q.id,
      mode: 'grila',
      prompt: q.prompt,
      options: opts,
      correctIndex: opts.findIndex((o) => o.isCorrect),
      correctOptionId: opts.find((o) => o.isCorrect).id,
    };
  });
}

async function pullRapide(prisma, count) {
  const ids = await prisma.$queryRaw`
    SELECT q.id FROM "Question" q
    JOIN "QuestionOption" o ON o."questionId" = q.id AND o."isCorrect" = true
    WHERE q."isPublished" = true AND trim(o."text") ~ '^-?[0-9]+$'
    ORDER BY random()
    LIMIT ${count}`;
  if (!ids.length) return [];
  const rows = await prisma.question.findMany({
    where: { id: { in: ids.map((r) => r.id) } },
    select: { id: true, prompt: true, options: { select: { id: true, text: true, isCorrect: true } } },
  });
  return rows
    .map((q) => {
      const correct = q.options.find((o) => o.isCorrect);
      if (!correct || !/^-?\d+$/.test(correct.text.trim())) return null;
      return {
        id: q.id,
        mode: 'rapide',
        prompt: q.prompt,
        options: [],
        correctIndex: null,
        correctOptionId: correct.id,
        correctNumber: parseInt(correct.text.trim(), 10),
      };
    })
    .filter(Boolean);
}

/** Pull a mixed, de-duplicated question list. grilaRatio of them are grila. */
async function pullMixed(prisma, total, grilaRatio = 0.6) {
  const nGrila = Math.max(0, Math.round(total * grilaRatio));
  const nRapide = total - nGrila;
  const [g, r] = await Promise.all([
    nGrila ? pullGrila(prisma, nGrila * 3) : Promise.resolve([]),
    nRapide ? pullRapide(prisma, nRapide * 3) : Promise.resolve([]),
  ]);
  const seen = new Set();
  const pick = (list, n) => {
    const out = [];
    for (const q of list) {
      if (out.length >= n) break;
      if (seen.has(q.id)) continue;
      seen.add(q.id);
      out.push(q);
    }
    return out;
  };
  const grila = pick(shuffle(g), nGrila);
  const rapide = pick(shuffle(r), nRapide);
  // interleave: grila first (round 1 is always grila so the first interaction is a button)
  const out = [];
  for (let i = 0; i < Math.max(grila.length, rapide.length); i++) {
    if (grila[i]) out.push(grila[i]);
    if (rapide[i]) out.push(rapide[i]);
  }
  return out;
}

/** Public (leak-free) view of a question for the transport: indices and labels only. */
function publicQuestion(q, labels = 'ABCD') {
  if (q.mode === 'grila') {
    return {
      mode: 'grila',
      prompt: q.prompt,
      options: q.options.map((o, i) => ({ index: i, label: labels[i] || String(i + 1), text: o.text })),
    };
  }
  return { mode: 'rapide', prompt: q.prompt, options: [], answerHint: 'număr întreg' };
}

module.exports = { pullGrila, pullRapide, pullMixed, publicQuestion, shuffle };
