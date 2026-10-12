import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireEditor, isError } from "@/lib/admin";

// POST /api/admin/questions/import { csv, dryRun? }
// Bulk-import questions from a CSV pasted by an admin/editor.
//   grila : <prompt>;A;B;C;D;<correct letter A-D>
//   rapide: <prompt>;<numeric answer>
// Delimiter is auto-detected (';', tab or ','). Published on import.
// dryRun=true parses and reports without writing anything.

const RAPIDE_MIN = -500;
const RAPIDE_MAX = 10_000_000;
const LETTERS = ["A", "B", "C", "D"];

function detectDelimiter(line: string): string {
  const counts: [string, number][] = [
    [";", (line.match(/;/g) || []).length],
    ["\t", (line.match(/\t/g) || []).length],
    [",", (line.match(/,/g) || []).length],
  ];
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ";";
}

// CSV field splitter: honours "..." quoting and doubled "" escapes.
function splitLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = false;
      } else cur += ch;
    } else if (ch === '"' && cur.trim() === "") {
      // a quote only opens a quoted field at the START of the field; a quote in
      // the middle (e.g. a title like "Mona Lisa") is a literal character
      quoted = true;
    } else if (ch === delim) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  // trim each field and drop trailing empties (stray trailing delimiter)
  const trimmed = out.map((s) => s.trim());
  while (trimmed.length && trimmed[trimmed.length - 1] === "") trimmed.pop();
  return trimmed;
}

type Row =
  | { kind: "grila"; prompt: string; options: string[]; correctIndex: number }
  | { kind: "rapide"; prompt: string; answer: number };

type Invalid = { line: number; reason: string };

function parseCsv(csv: string): { rows: Row[]; invalid: Invalid[]; total: number } {
  const rawLines = csv.replace(/^\uFEFF/, "").split(/\r?\n/); // drop a leading BOM
  const nonEmpty = rawLines.map((l, i) => ({ l, n: i + 1 })).filter((x) => x.l.trim().length > 0);
  if (!nonEmpty.length) return { rows: [], invalid: [], total: 0 };
  const delim = detectDelimiter(nonEmpty[0].l);

  const rows: Row[] = [];
  const invalid: Invalid[] = [];

  for (const { l, n } of nonEmpty) {
    const f = splitLine(l, delim);
    // header row? (also catches a possible BOM-free "Intrebare;Varianta A;…")
    if (n === nonEmpty[0].n && /^[îi]?ntrebare$/i.test((f[0] || "").replace(/^\uFEFF/, ""))) continue;

    const prompt = (f[0] || "").trim();
    if (l.includes("\ufffd") || prompt.includes("\ufffd")) {
      invalid.push({ line: n, reason: "caractere invalide (�) în locul diacriticelor" });
      continue;
    }
    if (!prompt) {
      invalid.push({ line: n, reason: "lipsește întrebarea" });
      continue;
    }

    if (f.length === 2) {
      const raw = f[1] ?? "";
      if (!/^-?\d+$/.test(raw)) {
        invalid.push({ line: n, reason: "răspuns rapid ne-numeric: " + (raw || "gol") });
        continue;
      }
      const answer = parseInt(raw, 10);
      if (answer < RAPIDE_MIN || answer > RAPIDE_MAX) {
        invalid.push({ line: n, reason: `răspuns în afara intervalului (${RAPIDE_MIN}..${RAPIDE_MAX})` });
        continue;
      }
      rows.push({ kind: "rapide", prompt, answer });
      continue;
    }

    if (f.length === 6) {
      const variants = f.slice(1, 5).map((v) => v.trim());
      const letter = (f[5] || "").trim().toUpperCase();
      if (variants.some((v) => !v)) {
        invalid.push({ line: n, reason: "una dintre variante este goală" });
        continue;
      }
      if (!LETTERS.includes(letter)) {
        invalid.push({ line: n, reason: "răspunsul corect trebuie să fie A, B, C sau D (primit: " + (f[5] || "gol") + ")" });
        continue;
      }
      rows.push({ kind: "grila", prompt, options: variants, correctIndex: LETTERS.indexOf(letter) });
      continue;
    }

    invalid.push({ line: n, reason: `număr de coloane neașteptat (${f.length}) — 6 pentru grilă, 2 pentru rapidă` });
  }

  return { rows, invalid, total: nonEmpty.length };
}

// ---- decoding -----------------------------------------------------------
// A Romanian CSV exported from Excel is usually Windows-1250 or ISO-8859-2,
// NOT UTF-8. Decoding those bytes as UTF-8 with errors="replace" silently turns
// every diacritic into U+FFFD, which is LOSSY and unrecoverable — that is how
// the Sankt Petersburg batch got mangled. So: try strict UTF-8 first, fall back
// to the legacy codecs, and refuse anything still containing a replacement char.
const FALLBACK_ENCODINGS = ["windows-1250", "iso-8859-2"];

// The legacy codecs only carry the old ce-dilla forms (ş ţ Ş Ţ); standard
// Romanian uses the comma-below forms (ș ț Ș Ț). Normalise after decoding so
// imported text matches the rest of the bank and searches line up.
function normalizeRomanian(s: string): string {
  return s
    .replace(/\u015f/g, "\u0219")
    .replace(/\u015e/g, "\u0218")
    .replace(/\u0163/g, "\u021b")
    .replace(/\u0162/g, "\u021a");
}

function decodeCsvBytes(bytes: Uint8Array, forced?: string) {
  const tried = forced ? [forced] : ["utf-8", ...FALLBACK_ENCODINGS];
  for (const enc of tried) {
    try {
      const text = new TextDecoder(enc, { fatal: enc === "utf-8" }).decode(bytes);
      if (!text.includes("\ufffd")) return { text, encoding: enc, error: "" };
    } catch {
      /* not this codec — try the next one */
    }
  }
  return {
    text: "",
    encoding: "",
    error: `Nu am putut decoda fișierul (încercat: ${tried.join(", ")}). Salvează-l ca "CSV UTF-8" și reîncearcă.`,
  };
}

export async function POST(req: Request) {
  const auth = await requireEditor();
  if (isError(auth)) return auth;

  const body = await req.json().catch(() => null);
  const b64 = typeof body?.csvBase64 === "string" ? body.csvBase64 : "";
  const rawCsv = typeof body?.csv === "string" ? body.csv : "";
  const forced = typeof body?.encoding === "string" && body.encoding ? body.encoding : undefined;
  const dryRun = body?.dryRun === true;

  // The file picker sends raw bytes (base64) so the browser can't destroy the
  // encoding; pasted text arrives already decoded as a JS string.
  let csv = rawCsv;
  let encoding = "text";
  if (b64) {
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(Buffer.from(b64, "base64"));
    } catch {
      return NextResponse.json({ error: "Fișier invalid (base64)." }, { status: 400 });
    }
    if (bytes.length > 5_000_000) return NextResponse.json({ error: "Fișier prea mare (max 5 MB)." }, { status: 413 });
    const dec = decodeCsvBytes(bytes, forced);
    if (dec.error) return NextResponse.json({ error: dec.error }, { status: 400 });
    csv = dec.text;
    encoding = dec.encoding;
  }
  if (!csv.trim()) return NextResponse.json({ error: "Niciun conținut de importat." }, { status: 400 });
  csv = normalizeRomanian(csv);
  if (csv.length > 5_000_000) return NextResponse.json({ error: "Fișier prea mare (max 5 MB)." }, { status: 413 });
  if (csv.includes("\ufffd")) {
    return NextResponse.json(
      { error: "Textul conține caractere invalide (�) în locul diacriticelor. Importă fișierul (nu copia textul), ca să detectez codificarea automat." },
      { status: 400 }
    );
  }

  const { rows, invalid, total } = parseCsv(csv);

  // de-dupe against the DB and within the file (case-insensitive prompt)
  const existing = await prisma.question.findMany({ select: { prompt: true } });
  const seen = new Set(existing.map((q) => q.prompt.trim().toLowerCase()));
  const unique: Row[] = [];
  let duplicates = 0;
  for (const r of rows) {
    const key = r.prompt.trim().toLowerCase();
    if (seen.has(key)) {
      duplicates++;
      continue;
    }
    seen.add(key);
    unique.push(r);
  }

  const grila = unique.filter((r) => r.kind === "grila").length;
  const rapide = unique.filter((r) => r.kind === "rapide").length;
  const importable = unique.length;

  let imported = 0;
  if (!dryRun && importable) {
    // chunked transactions: keeps memory/statement counts sane on big files
    const CHUNK = 100;
    for (let i = 0; i < unique.length; i += CHUNK) {
      const slice = unique.slice(i, i + CHUNK);
      await prisma.$transaction(
        slice.map((r) =>
          prisma.question.create({
            data: {
              prompt: r.prompt.slice(0, 1000),
              isPublished: true,
              difficulty: 1,
              options: {
                create:
                  r.kind === "grila"
                    ? r.options.map((text, pos) => ({ text: text.slice(0, 500), position: pos, isCorrect: pos === r.correctIndex }))
                    : [{ text: String(r.answer), position: 0, isCorrect: true }],
              },
            },
            select: { id: true },
          })
        )
      );
      imported += slice.length;
    }
  }

  return NextResponse.json({
    ok: true,
    dryRun,
    total,
    importable,
    imported,
    grila,
    rapide,
    duplicates,
    invalidCount: invalid.length,
    invalid: invalid.slice(0, 20),
    encoding,
  });
}
