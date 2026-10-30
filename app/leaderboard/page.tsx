"use client";

// Single clasament: the 90-second training blitz is the ranked game.
// Each row shows the best run's points (speed-weighted) and, in brackets, the
// old PRC rating — the number the site ranked on before the blitz existed. In
// "Tot timpul" players who never ran a blitz keep their place through that
// rating, so the board doesn't start empty on day one.
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

const card =
  "bg-gradient-to-br from-[#122420] to-[#0c1a17] border-2 border-[#1e3a34] rounded-2xl shadow-2xl";
const tabBtn = (on: boolean) =>
  `px-3 py-1.5 rounded-lg border text-[0.8rem] font-cinzel tracking-wider cursor-pointer transition ${
    on
      ? "border-[#9ec6c1] bg-[#1a3a35] text-[#e2eeeb]"
      : "border-[#1e3a34] bg-[#0c1a17] text-[#8fb0ac] hover:text-[#9ec6c1]"
  }`;
const GRID = "grid-cols-[2rem_minmax(0,1fr)_7rem_3.5rem_3rem]";

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
  const [rows, setRows] = useState<Row[]>([]);
  const [mine, setMine] = useState<Mine | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const load = useCallback(async (p: "day" | "all") => {
    setLoading(true);
    setErr("");
    try {
      const r = await fetch(`/api/train/leaderboard?period=${p}`, { cache: "no-store" });
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
    void load(period);
    const t = setInterval(() => void load(period), 30_000);
    return () => clearInterval(t);
  }, [period, load]);

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

      <div className={`${card} p-4 flex flex-col gap-3`}>
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
              onClick={() => void load(period)}
              title="Reîncarcă"
              className="text-[#75938f] hover:text-[#9ec6c1] cursor-pointer px-1.5 text-[0.9rem]"
            >
              ⟳
            </button>
          </div>
        </div>

        <p className="text-[0.75rem] text-[#75938f] leading-snug">
          Punctele adună tot ce ai răspuns {period === "day" ? "azi" : "de când există jocul"} — blitz de
          90 de secunde, cârciumă și turn. Un răspuns corect ia 50 de puncte plus până la 90 după cât
          de repede ai răspuns. În paranteze e ratingul vechi (PRC); cine nu a jucat încă apare pe
          locul lui din rating.
        </p>

        {mine && (
          <div className="rounded-xl border border-[#8fd9a8]/40 bg-[#0f2a20] px-3 py-2 flex flex-wrap items-center gap-2 text-[0.85rem]">
            <span className="text-[#8fd9a8] font-cinzel">locul tău</span>
            <span className="text-[#b9f5cd] font-cinzel">{mine.rank ? `#${mine.rank}` : "—"}</span>
            <span className="ml-auto text-[#b9f5cd] font-cinzel tabular-nums">
              {mine.basis === "rating" ? "—" : `${num(mine.points)} p`}
              {mine.prc != null && (
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
            <div className={`grid ${GRID} gap-2 text-[0.62rem] uppercase tracking-wider text-[#75938f] pb-1 border-b border-[#1e3a3450]`}>
              <span>#</span>
              <span>jucător</span>
              <span className="text-right">puncte (rating)</span>
              <span className="text-right">corecte</span>
              <span className="text-right">când</span>
            </div>
            {rows.map((r, i) => {
              const isMe = mine?.id === r.id;
              return (
                <div
                  key={r.id}
                  className={`grid ${GRID} gap-2 items-center py-1.5 border-b border-[#1e3a3430] text-[0.88rem] ${
                    isMe ? "text-[#b9f5cd]" : "text-[#cbdcda]"
                  }`}
                >
                  <span className="font-cinzel text-[#75938f]">{i + 1}.</span>
                  <span className="min-w-0 truncate">{r.name}</span>
                  <span className="text-right font-cinzel tabular-nums text-[#f0cf9a]">
                    {r.basis === "rating" ? <span className="text-[#75938f]">—</span> : num(r.points)}
                    {r.prc != null && (
                      <span className="ml-1 text-[#75938f] font-normal text-[0.74rem]">
                        {" "}({num(r.prc)})
                      </span>
                    )}
                  </span>
                  <span className="text-right text-[0.8rem] text-[#8fb0ac] tabular-nums">
                    {r.basis === "rating" ? "—" : r.correct}
                  </span>
                  <span className="text-right text-[0.72rem] text-[#75938f]">{when(r.at)}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
