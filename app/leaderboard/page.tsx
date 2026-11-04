"use client";

// Single clasament: the 90-second training blitz is the ranked game.
// Points aggregate every game (blitz runs, carciuma, tower answers — see
// lib/trainStats.ts) and are speed-weighted. "Tot timpul" also carries the old
// PRC rating, and a toggle picks which of the two orders the board: points for
// the whole-site total, rating for the number the site ranked on before the
// blitz existed (and so legacy players who never ran one keep their place).
// "Azi" resets at Romanian midnight.
import { useCallback, useEffect, useState } from "react";

type Row = {
  id: string;
  name: string;
  points: number;
  correct: number;
  total: number;
  at: string | null;
  prc: number | null;
  basis: "run" | "rating";
};
type Mine = Row & { rank: number | null };
type Sort = "points" | "rating";

const card =
  "bg-gradient-to-br from-[#122420] to-[#0c1a17] border-2 border-[#1e3a34] rounded-2xl shadow-2xl";
const tabBtn = (on: boolean) =>
  `px-3 py-1.5 rounded-lg border text-[0.8rem] font-cinzel tracking-wider cursor-pointer transition ${
    on
      ? "border-[#9ec6c1] bg-[#1a3a35] text-[#e2eeeb]"
      : "border-[#1e3a34] bg-[#0c1a17] text-[#8fb0ac] hover:text-[#9ec6c1]"
  }`;
// mobile: no room for "când" — drop that column below sm so the board never
// overflows the card on a phone. Rating goes under the points on narrow screens.
const GRID =
  "grid-cols-[1.3rem_minmax(0,1fr)_4.4rem_2.4rem] sm:grid-cols-[2rem_minmax(0,1fr)_7rem_3.5rem_3rem]";

const num = (n: number) => n.toLocaleString("ro-RO");

function when(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? d.toLocaleTimeString("ro-RO", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("ro-RO", { day: "2-digit", month: "short" });
}

export default function LeaderboardPage() {
  const [period, setPeriod] = useState<"day" | "all">("day");
  const [sort, setSort] = useState<Sort>("points");
  const [rows, setRows] = useState<Row[]>([]);
  const [mine, setMine] = useState<Mine | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const load = useCallback(async (p: "day" | "all", s: Sort) => {
    setLoading(true);
    setErr("");
    try {
      const r = await fetch(`/api/train/leaderboard?period=${p}&sort=${s}`, { cache: "no-store" });
      if (!r.ok) throw new Error(String(r.status));
      const d = await r.json();
      setRows(d.rows ?? []);
      setMine(d.mine ?? null);
    } catch {
      setErr("Nu am putut încărca clasamentul.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(period, sort);
    const t = setInterval(() => void load(period, sort), 30_000);
    return () => clearInterval(t);
  }, [period, sort, load]);

  // rating only makes sense for the whole history, so "Azi" always ranks by points
  const ratingBoard = period === "all" && sort === "rating";

  return (
    <div className="w-full max-w-[760px] mx-auto flex flex-col gap-4 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <a
          href="/"
          className="text-[#8fb0ac] hover:text-[#9ec6c1] text-[0.85rem] font-cinzel border border-[#1e3a34] rounded-lg px-3 py-1.5 bg-[#0c1a17]"
        >
          ← Înapoi
        </a>
        <a
          href="/train"
          className="text-[0.8rem] font-cinzel border border-[#1e3a34] rounded-lg px-3 py-1.5 bg-[#0c1a17] text-[#9ec6c1] hover:brightness-125"
        >
          ▶ Joacă 90s
        </a>
      </div>

      <div className={`${card} p-3 sm:p-4 flex flex-col gap-3`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="font-cinzel text-[#9ec6c1] text-[1.15rem] tracking-widest">👑 Clasament</h1>
          <div className="flex items-center gap-1.5">
            <button onClick={() => setPeriod("day")} className={tabBtn(period === "day")}>
              Azi
            </button>
            <button onClick={() => setPeriod("all")} className={tabBtn(period === "all")}>
              Tot timpul
            </button>
            <button
              onClick={() => void load(period, sort)}
              title="Reîncarcă"
              className="text-[#75938f] hover:text-[#9ec6c1] cursor-pointer px-1.5 text-[0.9rem]"
            >
              ⟳
            </button>
          </div>
        </div>

        {period === "all" && (
          <div className="flex items-center gap-1.5 -mt-1">
            <span className="text-[0.62rem] uppercase tracking-wider text-[#75938f] mr-0.5">clasat după</span>
            <button onClick={() => setSort("points")} className={tabBtn(sort === "points")}>
              Puncte
            </button>
            <button onClick={() => setSort("rating")} className={tabBtn(sort === "rating")}>
              Rating
            </button>
          </div>
        )}

        <p className="text-[0.72rem] sm:text-[0.75rem] text-[#75938f] leading-snug">
          {ratingBoard
            ? "Rating = PRC (grilă + rapide, ultimele 50 din fiecare). Punctele, în paranteze."
            : `Puncte = răspunsuri corecte ${
                period === "day" ? "azi" : "de când există jocul"
              } (blitz 90s, cârciumă, turn), mai rapid = mai multe. În paranteze e ratingul vechi (PRC).`}
        </p>

        {mine && (
          <div className="rounded-xl border border-[#8fd9a8]/40 bg-[#0f2a20] px-3 py-2 flex flex-wrap items-center gap-2 text-[0.85rem]">
            <span className="text-[#8fd9a8] font-cinzel">locul tău</span>
            <span className="text-[#b9f5cd] font-cinzel">{mine.rank ? `#${mine.rank}` : "—"}</span>
            <span className="ml-auto text-[#b9f5cd] font-cinzel tabular-nums">
              {ratingBoard
                ? mine.prc != null
                  ? `${num(mine.prc)} r`
                  : "—"
                : mine.basis === "rating"
                  ? "—"
                  : `${num(mine.points)} p`}
              {ratingBoard
                ? mine.basis !== "rating" && mine.points > 0 && (
                    <span className="text-[#8fb0ac] font-normal text-[0.78rem]"> ({num(mine.points)} p)</span>
                  )
                : mine.prc != null && (
                    <span className="text-[#8fb0ac] font-normal text-[0.78rem]">{" "}({num(mine.prc)})</span>
                  )}
            </span>
          </div>
        )}

        {err && (
          <div className="text-red-400 text-[0.85rem] border border-red-500/40 bg-red-900/20 rounded-lg px-3 py-2">
            {err}
          </div>
        )}

        {loading && rows.length === 0 && (
          <div className="text-[#75938f] text-[0.85rem] text-center py-6">Se încarcă…</div>
        )}

        {!loading && rows.length === 0 && (
          <div className="text-[#75938f] text-[0.85rem] text-center py-6">
            {period === "day" ? "Nimeni nu a jucat azi." : "Niciun run înregistrat încă."}{" "}
            <a href="/train" className="underline hover:text-[#9ec6c1]">
              Pornește primul 90s
            </a>
            .
          </div>
        )}

        {rows.length > 0 && (
          <div className="flex flex-col">
            <div className={`grid ${GRID} gap-1.5 sm:gap-2 text-[0.58rem] sm:text-[0.62rem] uppercase tracking-wider text-[#75938f] pb-1 border-b border-[#1e3a3450]`}>
              <span>#</span>
              <span>jucător</span>
              <span className="text-right">
                {ratingBoard ? "rating" : "puncte"}
                <span className="hidden sm:inline"> ({ratingBoard ? "puncte" : "rating"})</span>
              </span>
              <span className="text-right">
                <span className="sm:hidden">✓</span>
                <span className="hidden sm:inline">corecte</span>
              </span>
              <span className="text-right hidden sm:block">când</span>
            </div>
            {rows.map((r, i) => {
              const isMe = mine?.id === r.id;
              return (
                <div
                  key={r.id}
                  className={`grid ${GRID} gap-1.5 sm:gap-2 items-center py-1.5 border-b border-[#1e3a3430] text-[0.82rem] sm:text-[0.88rem] ${
                    isMe ? "text-[#b9f5cd]" : "text-[#cbdcda]"
                  }`}
                >
                  <span className="font-cinzel text-[#75938f]">{i + 1}.</span>
                  <span className="min-w-0 truncate">{r.name}</span>
                  <span className="text-right font-cinzel tabular-nums text-[#f0cf9a] leading-tight">
                    {ratingBoard ? (
                      <>
                        {r.prc != null ? num(r.prc) : <span className="text-[#75938f]">—</span>}
                        {r.basis !== "rating" && r.points > 0 && (
                          <span className="block text-[#75938f] font-normal text-[0.66rem] sm:text-[0.72rem]">
                            ({num(r.points)})
                          </span>
                        )}
                      </>
                    ) : (
                      <>
                        {r.basis === "rating" ? <span className="text-[#75938f]">—</span> : num(r.points)}
                        {r.prc != null && (
                          <span className="block text-[#75938f] font-normal text-[0.66rem] sm:text-[0.72rem]">
                            ({num(r.prc)})
                          </span>
                        )}
                      </>
                    )}
                  </span>
                  <span className="text-right text-[0.8rem] text-[#8fb0ac] tabular-nums">
                    {r.basis === "rating" ? "—" : r.correct}
                  </span>
                  <span className="text-right text-[0.72rem] text-[#75938f] hidden sm:block">{when(r.at)}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
