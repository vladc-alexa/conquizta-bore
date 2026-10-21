"use client";

// The Turnul lobby: open a tower room (8 seats) or join one that's waiting.
// Empty chairs are filled by bots when the host starts, so a solo player can
// climb straight away.
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type OpenGame = { id: string; hostName: string; createdAt: string; mine: boolean; joined: number };

function ago(iso: string) {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m`;
}

export default function TowerLobbyPanel({ onUnauthorized }: { onUnauthorized?: () => void }) {
  const router = useRouter();
  const [games, setGames] = useState<OpenGame[]>([]);
  const [mineGame, setMineGame] = useState<{ id: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState<string | null>(null);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/tower/open", { cache: "no-store" });
      if (r.status === 401) {
        onUnauthorized?.();
        return;
      }
      if (!r.ok) return;
      const d = await r.json();
      setGames(d.games ?? []);
      setMineGame(d.mine ?? null);
    } catch {
      /* keep the last list */
    }
  }, [onUnauthorized]);

  useEffect(() => {
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [load]);

  async function create() {
    setCreating(true);
    setErr("");
    try {
      const r = await fetch("/api/tower", { method: "POST" });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.gameId) {
        router.push(`/tower/${d.gameId}`);
        return;
      }
      setErr(d.error || "N-am putut deschide turnul.");
    } catch {
      setErr("Eroare de rețea.");
    }
    setCreating(false);
  }

  async function join(id: string) {
    setJoining(id);
    setErr("");
    try {
      const r = await fetch(`/api/tower/${id}/join`, { method: "POST" });
      const d = await r.json().catch(() => ({}));
      if (r.ok) {
        router.push(`/tower/${id}`);
        return;
      }
      setErr(d.error || "N-am putut intra în turn.");
      load();
    } catch {
      setErr("Eroare de rețea.");
    }
    setJoining(null);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-cinzel text-[#9ec6c1] text-[0.9rem] tracking-widest">🏰 Turnul</h3>
        <span className="text-[#75938f] text-[0.65rem]">8 JUCĂTORI · 9 RUNDE</span>
      </div>

      <button
        onClick={create}
        disabled={creating}
        className="bg-gradient-to-br from-[#d9a441] to-[#9c7020] border-2 border-[#d9a44180] rounded-xl text-[#0c1a17] font-cinzel text-[0.95rem] tracking-wider p-3 hover:brightness-110 active:translate-y-px disabled:opacity-60 cursor-pointer"
      >
        {creating ? "Se deschide…" : "➕ Deschide turnul"}
      </button>

      {mineGame && (
        <a
          href={`/tower/${mineGame.id}`}
          className="text-center bg-[#122420] border-2 border-[#d9a441a0] rounded-xl text-[#e8c46a] font-cinzel text-[0.85rem] p-2.5 hover:brightness-125"
        >
          ⏳ Turnul tău e în desfășurare — intră
        </a>
      )}

      <div className="flex items-center justify-between text-[0.7rem] text-[#75938f] pt-1">
        <span className="uppercase tracking-wider">Turnuri deschise</span>
        <button onClick={load} className="hover:text-[#9ec6c1] cursor-pointer" title="Reîmprospătează">
          ⟳
        </button>
      </div>

      <div className="flex flex-col gap-1.5">
        {games.length === 0 ? (
          <div className="text-[#75938f] text-[0.78rem] text-center p-4 border border-dashed border-[#1e3a34] rounded-xl">
            Niciun turn deschis. Deschide unul — boții ocupă locurile libere.
          </div>
        ) : (
          games.map((g) => (
            <div key={g.id} className="flex items-center justify-between gap-2 bg-[#050d0b] border border-[#1e3a34] rounded-xl p-2 pl-3">
              <span className="min-w-0">
                <span className="font-cinzel text-[#cbdcda] text-[0.85rem] truncate block">
                  {g.hostName}
                  {g.mine && <span className="text-[#9ec6c1]"> (tu)</span>}
                </span>
                <span className="text-[#75938f] text-[0.65rem]">
                  {g.joined}/8 locuri · deschis de {ago(g.createdAt)}
                </span>
              </span>
              {g.mine ? (
                <a
                  href={`/tower/${g.id}`}
                  className="shrink-0 bg-gradient-to-br from-[#2c514c] to-[#101f1c] border-2 border-[#4d7a76a0] rounded-lg text-[#e2eeeb] font-cinzel text-[0.78rem] px-3 py-1.5 hover:brightness-125"
                >
                  Continuă
                </a>
              ) : (
                <button
                  onClick={() => join(g.id)}
                  disabled={joining !== null}
                  className="shrink-0 bg-gradient-to-br from-[#d9a441] to-[#7d5a1c] border-2 border-[#d9a44160] rounded-lg text-[#10201b] font-cinzel text-[0.78rem] px-3.5 py-1.5 hover:brightness-110 disabled:opacity-50 cursor-pointer"
                >
                  {joining === g.id ? "Intru…" : "Join"}
                </button>
              )}
            </div>
          ))
        )}
      </div>

      {err && <div className="text-red-400 text-[0.75rem]">{err}</div>}
    </div>
  );
}
