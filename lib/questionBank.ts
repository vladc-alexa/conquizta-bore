import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

interface LocalMcQuestion {
  id: string;
  category: string;
  categoryEn?: string;
  difficulty?: number;
  prompt: string;
  options: string[];
  correctIndex: number;
}

interface LocalNumQuestion {
  id: string;
  category: string;
  categoryEn?: string;
  prompt: string;
  answer: number;
}

const bankCache: Record<string, unknown[]> = {};
const liveTranslationCache = new Map<string, string>();

function loadJsonBank<T>(relPath: string): T[] {
  if (bankCache[relPath] && bankCache[relPath].length > 0) {
    return bankCache[relPath] as T[];
  }
  try {
    const p = resolve(process.cwd(), relPath);
    if (!existsSync(p)) return [];
    const raw = JSON.parse(readFileSync(p, "utf8"));
    const list = Array.isArray(raw) ? raw : raw.questions ?? [];
    if (list.length > 0) bankCache[relPath] = list;
    return list as T[];
  } catch {
    return [];
  }
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function inferResponseType(prompt: string, answer: number): string {
  if (/în ce an\b|în anul\b|\banul\b|când a fost|când s-a născut|când a murit|când a apărut|what year/i.test(prompt)) {
    return "an";
  }
  if (answer < 0) return "număr negativ";
  return "număr";
}

async function translateLiveStrings(texts: string[], sl: string, tl: string): Promise<string[]> {
  if (sl === tl || texts.length === 0) return texts;
  const out = [...texts];
  const missingIdx: number[] = [];
  const missingTexts: string[] = [];

  for (let i = 0; i < texts.length; i++) {
    const key = `${sl}:${tl}:${texts[i]}`;
    const hit = liveTranslationCache.get(key);
    if (hit) out[i] = hit;
    else {
      missingIdx.push(i);
      missingTexts.push(texts[i]);
    }
  }

  if (missingTexts.length === 0) return out;

  try {
    const SEP = "\n|||QSEP|||\n";
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sl}&tl=${tl}&dt=t&q=${encodeURIComponent(
      missingTexts.join(SEP)
    )}`;
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (res.ok) {
      const data = await res.json();
      const joined = Array.isArray(data?.[0]) ? data[0].map((s: unknown[]) => String(s?.[0] ?? "")).join("") : "";
      const parts = joined.split(/\s*\|\|\|\s*QSEP\s*\|\|\|\s*/i).map((s: string) => s.trim());
      if (parts.length === missingTexts.length) {
        for (let k = 0; k < parts.length; k++) {
          const val = parts[k] || missingTexts[k];
          out[missingIdx[k]] = val;
          liveTranslationCache.set(`${sl}:${tl}:${missingTexts[k]}`, val);
        }
      }
    }
  } catch {
    // Graceful fallback to source text if offline
  }

  return out;
}

async function serveLocal(mode: "rapide" | "grila", count: number, lang: "ro" | "en", category: string | null) {
  if (mode === "rapide") {
    const roPool = lang === "ro" ? loadJsonBank<LocalNumQuestion>("data/questions-numeric-ro.json") : [];
    const needsLiveTranslate = lang === "ro" && roPool.length === 0;
    const pool = roPool.length > 0 ? roPool : loadJsonBank<LocalNumQuestion>("data/questions-numeric-en.json");
    const filtered =
      category && category !== "all"
        ? pool.filter((q) => q.category.toLowerCase() === category.toLowerCase())
        : pool;
    const chosen = shuffle(filtered.length ? filtered : pool).slice(0, count);

    if (needsLiveTranslate && chosen.length > 0) {
      const translatedPrompts = await translateLiveStrings(
        chosen.map((q) => q.prompt),
        "en",
        "ro"
      );
      return {
        questions: chosen.map((q, idx) => ({
          id: q.id,
          category: q.category,
          prompt: translatedPrompts[idx],
          answer: q.answer,
          responseType: inferResponseType(translatedPrompts[idx], q.answer),
        })),
        totalBank: pool.length,
      };
    }

    return {
      questions: chosen.map((q) => ({
        id: q.id,
        category: q.category,
        prompt: q.prompt,
        answer: q.answer,
        responseType: inferResponseType(q.prompt, q.answer),
      })),
      totalBank: pool.length,
    };
  }

  const roPool = lang === "ro" ? loadJsonBank<LocalMcQuestion>("data/questions-ro.json") : [];
  const needsLiveTranslate = lang === "ro" && roPool.length === 0;
  const pool = roPool.length > 0 ? roPool : loadJsonBank<LocalMcQuestion>("data/questions-en.json");
  const filtered =
    category && category !== "all"
      ? pool.filter((q) => q.category.toLowerCase() === category.toLowerCase())
      : pool;
  const chosen = shuffle(filtered.length ? filtered : pool).slice(0, count);

  const prepared = chosen.map((q) => {
    const order = shuffle([0, 1, 2, 3]);
    return {
      id: q.id,
      category: q.category,
      difficulty: q.difficulty ?? 2,
      prompt: q.prompt,
      options: order.map((i) => q.options[i]),
      correctIndex: order.indexOf(q.correctIndex),
    };
  });

  if (needsLiveTranslate && prepared.length > 0) {
    const flat: string[] = [];
    for (const q of prepared) {
      flat.push(q.prompt, ...q.options);
    }
    const translated = await translateLiveStrings(flat, "en", "ro");
    let c = 0;
    for (const q of prepared) {
      q.prompt = translated[c++];
      q.options = [translated[c++], translated[c++], translated[c++], translated[c++]];
    }
  }

  return { questions: prepared, totalBank: pool.length };
}

/** Bank/DB metadata for the question pickers. */
export function questionMeta(lang: "ro" | "en" = "ro") {
  const mcRo = lang === "ro" ? loadJsonBank<LocalMcQuestion>("data/questions-ro.json") : [];
  const mc = mcRo.length > 0 ? mcRo : loadJsonBank<LocalMcQuestion>("data/questions-en.json");
    const numRo = lang === "ro" ? loadJsonBank<LocalNumQuestion>("data/questions-numeric-ro.json") : [];
  const num = numRo.length > 0 ? numRo : loadJsonBank<LocalNumQuestion>("data/questions-numeric-en.json");

    const mcCategories = [...new Set(mc.map((q) => q.category))].sort();
  const numCategories = [...new Set(num.map((q) => q.category))].sort();
  return {
    lang,
    mcCount: mc.length,
    numCount: num.length,
    totalCount: mc.length + num.length,
    mcCategories,
    numCategories,
  };
}


/** Same picker the /api/questions route serves: published DB questions blended with the local bank. */
export async function serveQuestion(
  mode: "rapide" | "grila",
  count: number,
  lang: "ro" | "en",
  category: string | null
) {
  if (lang === "en" || (category && category !== "all")) {
    return serveLocal(mode, count, lang, category);
  }

  // Romanian mode (default): mix published PostgreSQL DB questions (if available) with the translated bank.
  // Capped at half the batch on purpose: with 2 700+ published DB rows the DB alone always satisfied
  // the request, which starved the newer bank questions (Open Trivia import) out of every Romanian game.
  const dbWant = Math.max(1, Math.ceil(count / 2));
  try {
    let ids: { id: string }[];
    if (mode === "rapide") {
      ids = await prisma.$queryRaw`
        SELECT q.id FROM "Question" q
        JOIN "QuestionOption" o ON o."questionId" = q.id AND o."isCorrect" = true
        WHERE q."isPublished" = true AND trim(o."text") ~ '^-?[0-9]+$'
        ORDER BY random()
        LIMIT ${dbWant}`;
    } else {
      ids = await prisma.$queryRaw`
        SELECT q.id FROM "Question" q
        WHERE q."isPublished" = true
          AND (SELECT count(*) FROM "QuestionOption" o WHERE o."questionId" = q.id) = 4
          AND (SELECT count(*) FROM "QuestionOption" o WHERE o."questionId" = q.id AND o."isCorrect" = true) = 1
        ORDER BY random()
        LIMIT ${dbWant}`;
    }

    if (ids.length > 0) {
      const questions = await prisma.question.findMany({
        where: { id: { in: ids.map((r) => r.id) } },
        select: {
          id: true,
          prompt: true,
          category: { select: { name: true } },
          options: { select: { text: true, isCorrect: true }, orderBy: { position: "asc" } },
        },
      });

      if (mode === "rapide") {
        const dbOut = questions
          .map((q) => {
            const correct = q.options.find((o) => o.isCorrect);
            if (!correct || !/^-?\d+$/.test(correct.text.trim())) return null;
            const answer = parseInt(correct.text.trim(), 10);
            return {
              id: q.id,
              category: q.category?.name ?? "General",
              prompt: q.prompt,
              answer,
              responseType: inferResponseType(q.prompt, answer),
            };
          })
          .filter(Boolean);
        const topUp = await serveLocal("rapide", Math.max(0, count - dbOut.length), "ro", null);
        return { questions: shuffle([...dbOut, ...topUp.questions]) };
      } else {
        const dbOut = questions
          .map((q) => {
            if (q.options.length !== 4 || q.options.filter((o) => o.isCorrect).length !== 1) return null;
            const correctIndex = q.options.findIndex((o) => o.isCorrect);
            const order = shuffle([0, 1, 2, 3]);
            return {
              id: q.id,
              category: q.category?.name ?? "General",
              prompt: q.prompt,
              options: order.map((i) => q.options[i].text),
              correctIndex: order.indexOf(correctIndex),
            };
          })
          .filter(Boolean);
        const topUp = await serveLocal("grila", Math.max(0, count - dbOut.length), "ro", null);
        return { questions: shuffle([...dbOut, ...topUp.questions]) };
      }
    }
  } catch {
    // DB unavailable locally — serve translated Romanian bank seamlessly
  }

  return serveLocal(mode, count, lang, category);
}
