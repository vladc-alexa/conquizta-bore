import { NextResponse } from "next/server";
import { questionMeta, serveQuestion } from "@/lib/questionBank";

export const dynamic = "force-dynamic";

// GET /api/questions?mode=rapide|grila&count=10&lang=ro|en&category=all
// GET /api/questions?meta=1&lang=ro|en -> returns localized bank counts & categories
export async function GET(req: Request) {
  const url = new URL(req.url);
  const lang: "ro" | "en" = url.searchParams.get("lang") === "en" ? "en" : "ro";

  if (url.searchParams.get("meta") === "1") {
    return NextResponse.json(questionMeta(lang));
  }

  const mode = url.searchParams.get("mode");
  const category = url.searchParams.get("category");
  const count = Math.min(Math.max(parseInt(url.searchParams.get("count") || "10", 10) || 10, 1), 30);

  if (mode !== "rapide" && mode !== "grila") {
    return NextResponse.json({ error: "mode must be rapide or grila" }, { status: 400 });
  }

  return NextResponse.json(await serveQuestion(mode, count, lang, category));
}
