"use client";

// The 1 la 1 lobby: create a match, then anyone can walk in with Join.
// No link copying — open matches are listed right here on the dashboard and
// refreshed every few seconds.
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type OpenGame = { id: string; hostName: string; createdAt: string; mine: boolean };
type Mine = { id: string; status: string } | null;

function ago(iso: string) {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m`;
}

export default function DuelLobbyPanel({ onUnauthorized }: { onUnauthorized?: () => void }) {
  const router = useRouter();
  const [games, setGames] = useState<OpenGame[]>([]);
  const [mine, setMine] = useState<Mine>(null);
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState<string | null>(null);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/duel/open", { cache: "no-store" });
      if (r.status === 401) {
        onUnauthorized?.();
        return;
      }
      if (!r.ok) return;
      const d = await r.json();
      setGames(d.games ?? []);
      setMine(d.mine ?? null);
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
      const r = await fetch("/api/duel", { method: "POST" });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.duelId) {
        router.push(`/duel/${d.duelId}`);
        return;
      }
      setErr(d.error || "N-am putut crea meciul.");
    } catch {
      setErr("Eroare de rețea.");
    }
    setCreating(false);
  }

  async function join(id: string) {
    setJoining(id);
    setErr("");
    try {
      const r = await fetch(`/api/duel/${id}/join`, { method: "POST" });
      const d = await r.json().catch(() => ({}));
      if (r.ok) {
        router.push(`/duel/${id}`);
        return;
      }
      setErr(d.error || "N-am putut intra în meci.");
      load();
    } catch {
      setErr("Eroare de rețea.");
    }
    setJoining(null);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-cinzel text-[#9ec6c1] text-[0.9rem] tracking-widest">⚔️ 1 la 1</h3>
      </div>

      <button
        onClick={create}
        disabled={creating}
        className="bg-gradient-to-br from-[#9ec6c1] to-[#6f9c99] border-2 border-[#9ec6c180] rounded-xl text-[#0c1a17] font-cinzel text-[0.95rem] tracking-wider p-3 hover:brightness-110 active:translate-y-px disabled:opacity-60 cursor-pointer"
      >
        {creating ? "Se creează…" : "➕ Creează meci"}
      </button>

      {mine?.status === "WAITING" && (
        <a
          href={`/duel/${mine.id}`}
          className="text-center bg-[#122420] border-2 border-[#6f9c99a0] rounded-xl text-[#9ec6c1] font-cinzel text-[0.85rem] p-2.5 hover:brightness-125"
        >
          ⏳ Meciul tău așteaptă un adversar — vezi-l
        </a>
      )}

      <div className="flex items-center justify-between text-[0.7rem] text-[#75938f] pt-1">
        <span className="uppercase tracking-wider">Meciuri deschise</span>
        <button onClick={load} className="hover:text-[#9ec6c1] cursor-pointer" title="Reîmprospătează">
          ⟳
        </button>
      </div>

      <div className="flex flex-col gap-1.5">
        {games.length === 0 ? (
          <div className="text-[#75938f] text-[0.78rem] text-center p-4 border border-dashed border-[#1e3a34] rounded-xl">
            Niciun meci deschis.
          </div>
        ) : (
          games.map((g) => (
            <div
              key={g.id}
              className="flex items-center justify-between gap-2 bg-[#050d0b] border border-[#1e3a34] rounded-xl p-2 pl-3"
            >
              <span className="min-w-0">
                <span className="font-cinzel text-[#cbdcda] text-[0.85rem] truncate block">
                  {g.hostName}
                  {g.mine && <span className="text-[#9ec6c1]"> (tu)</span>}
                </span>
                <span className="text-[#75938f] text-[0.65rem]">deschis de {ago(g.createdAt)}</span>
              </span>
              {g.mine ? (
                <a
                  href={`/duel/${g.id}`}
                  className="shrink-0 bg-gradient-to-br from-[#2c514c] to-[#101f1c] border-2 border-[#4d7a76a0] rounded-lg text-[#e2eeeb] font-cinzel text-[0.78rem] px-3 py-1.5 hover:brightness-125"
                >
                  Continuă
                </a>
              ) : (
                <button
                  onClick={() => join(g.id)}
                  disabled={joining !== null}
                  className="shrink-0 bg-gradient-to-br from-[#6f9c99] to-[#2c514c] border-2 border-[#9ec6c160] rounded-lg text-[#e2eeeb] font-cinzel text-[0.78rem] px-3.5 py-1.5 hover:brightness-110 disabled:opacity-50 cursor-pointer"
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
