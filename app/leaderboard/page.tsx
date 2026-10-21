"use client";

// Full standings: score (PRC), games played and the date each player joined.
import { useCallback, useEffect, useState } from "react";

type Row = {
  id: string;
  name: string;
  prc: number | null;
  grila: number | null;
  rapide: number | null;
  games: number;
  joinedAt?: string | null;
};

type Online = { id: string; name: string; at?: string; you?: boolean };

function fmtDate(iso?: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("ro-RO", { day: "2-digit", month: "short", year: "numeric" });
}

export default function LeaderboardPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [me, setMe] = useState<(Row & { hidden?: boolean }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [scoreHidden, setScoreHidden] = useState(false);
  const [online, setOnline] = useState<Online[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/leaderboard?scope=all", { cache: "no-store" });
      if (r.status === 401) {
        window.location.href = "/login";
        return;
      }
      if (!r.ok) return;
      const d = await r.json();
      setRows(d.rows ?? []);
      setOnline(d.online ?? []);
      setMe(d.me ?? null);
      setScoreHidden(!!d.me?.hidden);
    } catch {
      /* keep what we have */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    // presence is only fresh for 2 minutes — refresh the page data quietly
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  const toggleHidden = async () => {
    try {
      const r = await fetch("/api/auth/hide-score", { method: "POST" });
      if (r.ok) {
        const d = await r.json();
        setScoreHidden(!!d.hideScore);
        load();
      }
    } catch {
      /* ignore */
    }
  };

  const meInList = me ? rows.some((r) => r.id === me.id) : false;
  const onlineIds = new Set(online.map((p) => p.id));
  const onlineNames = online.map((p) => p.name);

  const rowBody = (r: Row, pos: number | string, highlight: boolean) => (
    <>
      <span className="text-[#75938f] text-[0.75rem]">{pos}</span>
      <span className="min-w-0">
        <span className={`font-cinzel truncate block ${highlight ? "text-[#9ec6c1]" : "text-[#cbdcda]"}`}>
          {onlineIds.has(r.id) && (
            <span className="online-dot mr-1.5" title="Online acum" aria-label="online" />
          )}
          {r.name}
          {highlight && " (tu)"}
        </span>
        <span className="text-[0.65rem] text-[#75938f] block truncate">
          {r.grila !== null && <>grilă {r.grila}</>}
          {r.grila !== null && r.rapide !== null && " · "}
          {r.rapide !== null && <>rapide {r.rapide}</>}
          {r.grila === null && r.rapide === null && "fără detalii"}
        </span>
      </span>
      <span className="font-cinzel text-[#9ec6c1] font-bold text-[1rem] text-right">
        {r.prc != null ? r.prc.toLocaleString("ro-RO") : "—"}
      </span>
      <span className="text-right text-[0.82rem] text-[#cbdcda]">{r.games}</span>
      <span className="text-right text-[0.72rem] text-[#8fb0ac] whitespace-nowrap">{fmtDate(r.joinedAt)}</span>
    </>
  );

  return (
    <div className="w-full max-w-4xl mx-auto flex flex-col gap-4 py-2">
      <div className="flex items-center justify-between gap-2">
        <a
          href="/"
          className="text-[#8fb0ac] hover:text-[#9ec6c1] text-[0.85rem] font-cinzel border border-[#1e3a34] rounded-lg px-3 py-1.5 bg-[#0c1a17]"
        >
          ← Înapoi
        </a>
        <div className="flex items-center gap-2">
          <button
            onClick={toggleHidden}
            className={`text-[0.7rem] border rounded-lg px-2 py-1.5 cursor-pointer hover:brightness-110 ${
              scoreHidden
                ? "text-[#b57edc] border-purple-500/40 bg-purple-900/20"
                : "text-[#8fb0ac] border-[#1e3a34] hover:bg-[#122420]"
            }`}
            title={scoreHidden ? "Scorul tău e ascuns public — arată-l" : "Ascunde scorul tău din clasamentul public"}
          >
            {scoreHidden ? "🔒 Scor ascuns" : "🔒 Ascunde scorul"}
          </button>
          <button
            onClick={load}
            className="text-[#8fb0ac] hover:text-[#9ec6c1] text-[0.9rem] border border-[#1e3a34] rounded-lg px-2.5 py-1 bg-[#0c1a17] cursor-pointer"
            title="Reîmprospătează"
          >
            ⟳
          </button>
        </div>
      </div>

      {/* who is around right now — beats in from every open tab */}
      <section className="bg-gradient-to-br from-[#122420] to-[#0c1a17] border-2 border-[#1e3a34] rounded-2xl shadow-2xl p-[1.15rem] flex flex-col gap-2">
        <h2 className="font-cinzel text-[#9ec6c1] text-[0.95rem] tracking-widest flex items-center gap-2">
          <span className="online-dot" />
          Online acum
          <span className="text-[#75938f] text-[0.78rem] tracking-normal font-normal">({online.length})</span>
        </h2>
        {online.length === 0 ? (
          <div className="text-[#75938f] text-[0.78rem]">Nimeni online în acest moment.</div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {onlineNames.map((n, i) => (
              <span
                key={online[i].id}
                className={`rounded-lg border px-2 py-1 text-[0.75rem] font-cinzel ${
                  online[i].you
                    ? "border-[#5d8b88a0] bg-[#5d8b8826] text-[#9ec6c1]"
                    : "border-[#1e3a34] bg-[#0c1a17] text-[#cbdcda]"
                }`}
              >
                {n}
                {online[i].you && <span className="text-[#75938f]"> (tu)</span>}
              </span>
            ))}
          </div>
        )}
      </section>

      <section className="bg-gradient-to-br from-[#122420] to-[#0c1a17] border-2 border-[#1e3a34] rounded-2xl shadow-2xl p-[1.15rem] flex flex-col gap-2">
        <h1 className="font-cinzel text-[#9ec6c1] text-[1.1rem] tracking-widest !mb-0 !text-[1.1rem]">
          👑 Clasament
        </h1>

        <div className="grid grid-cols-[28px_1fr_70px_58px_92px] gap-2 text-[0.62rem] uppercase tracking-wider text-[#75938f] border-b border-[#1e3a3460] pb-1.5">
          <span>#</span>
          <span>Jucător</span>
          <span className="text-right">Scor</span>
          <span className="text-right">Meciuri</span>
          <span className="text-right">Înscris</span>
        </div>

        {loading && rows.length === 0 ? (
          <div className="text-[#75938f] text-[0.8rem] text-center p-6">Se încarcă…</div>
        ) : rows.length === 0 ? (
          <div className="text-[#75938f] text-[0.8rem] text-center p-6">
            Niciun jucător clasat încă. Antrenează-te!
          </div>
        ) : (
          <div className="flex flex-col">
            {rows.map((r, i) => (
              <div
                key={r.id}
                className={`grid grid-cols-[28px_1fr_70px_58px_92px] gap-2 text-[0.82rem] p-1.5 px-2 rounded items-center odd:bg-white/5 ${
                  r.id === me?.id ? "bg-[#5d8b8826] border border-[#5d8b88a0]" : ""
                }`}
              >
                {rowBody(r, i + 1, r.id === me?.id)}
              </div>
            ))}

            {me && !meInList && (
              <>
                <div className="border-t border-[#1e3a3460] my-1" />
                <div className="grid grid-cols-[28px_1fr_70px_58px_92px] gap-2 text-[0.82rem] p-1.5 px-2 rounded items-center bg-[#5d8b8826] border border-[#5d8b88a0]">
                  {rowBody(me, rows.length + 1, true)}
                </div>
              </>
            )}
          </div>
        )}

        {me?.hidden && (
          <div className="text-[0.7rem] text-[#b57edc]">
            🔒 Scorul tău e ascuns public — doar tu îl vezi aici.
          </div>
        )}
      </section>
    </div>
  );
}
