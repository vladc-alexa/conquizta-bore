"use client";

// The Turnul lobby: open a tower room (8 seats) or take a free chair in one.
// Everything happens on this page — the seat table fills up with real names as
// people join, the host presses Start (empty chairs are filled by bots), and the
// panel jumps into the tower only once the climb actually begins.
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type OpenGame = {
  id: string;
  hostName: string;
  createdAt: string;
  joined: number;
  players: string[];
};

type Mine = {
  id: string;
  status: string;
  role: "host" | "player";
  hostName: string;
  players: string[];
} | null;

function ago(iso: string) {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m`;
}

const SEATS = 8;

export default function TowerLobbyPanel({ onUnauthorized, onClose }: { onUnauthorized?: () => void; onClose?: () => void }) {
  const router = useRouter();
  const [games, setGames] = useState<OpenGame[]>([]);
  const [mine, setMine] = useState<Mine>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const prev = useRef<{ id: string; status: string } | null>(null);

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
      setMine(d.mine ?? null);
    } catch {
      /* keep the last list */
    }
  }, [onUnauthorized]);

  useEffect(() => {
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [load]);

  // jump into the tower when the host opens it (waiting -> running flip only)
  useEffect(() => {
    if (!mine) {
      prev.current = null;
      return;
    }
    const before = prev.current;
    if (before && before.id === mine.id && before.status === "WAITING" && mine.status === "IN_PROGRESS") {
      router.push(`/tower/${mine.id}`);
      return;
    }
    prev.current = { id: mine.id, status: mine.status };
  }, [mine, router]);

  async function create() {
    setBusy("create");
    setErr("");
    try {
      const r = await fetch("/api/tower", { method: "POST" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.gameId) setErr(d.error || "N-am putut deschide turnul.");
      await load();
    } catch {
      setErr("Eroare de rețea.");
    }
    setBusy(null);
  }

  async function join(id: string) {
    setBusy(id);
    setErr("");
    try {
      const r = await fetch(`/api/tower/${id}/join`, { method: "POST" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) setErr(d.error || "N-am putut intra în turn.");
      await load();
    } catch {
      setErr("Eroare de rețea.");
    }
    setBusy(null);
  }

  async function start(id: string) {
    setBusy("start");
    setErr("");
    try {
      const r = await fetch(`/api/tower/${id}/start`, { method: "POST" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErr(d.error || "N-am putut porni turnul.");
        await load();
        return;
      }
      prev.current = { id, status: "IN_PROGRESS" };
      router.push(`/tower/${id}`);
    } catch {
      setErr("Eroare de rețea.");
    }
    setBusy(null);
  }

  async function leave(id: string) {
    setBusy("leave");
    setErr("");
    try {
      await fetch(`/api/tower/${id}/leave`, { method: "POST" });
      prev.current = null;
      await load();
    } catch {
      setErr("Eroare de rețea.");
    }
    setBusy(null);
  }

  const waiting = mine?.status === "WAITING";
  const hosting = waiting && mine?.role === "host";
  const live = mine?.status === "IN_PROGRESS";
  const filled = mine?.players.length ?? 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-cinzel text-[#9ec6c1] text-[0.9rem] tracking-widest">🏰 Turnul</h3>
        <div className="flex items-center gap-2">
          <span className="text-[#75938f] text-[0.65rem]">8 JUCĂTORI · 36 DE TREPTE</span>
          {onClose && (
            <button onClick={onClose} title="Închide turnul" className="text-[#75938f] hover:text-[#9ec6c1] cursor-pointer">
              ✕
            </button>
          )}
        </div>
      </div>

      {!mine && (
        <button
          onClick={create}
          disabled={busy !== null}
          className="bg-gradient-to-br from-[#d9a441] to-[#9c7020] border-2 border-[#d9a44180] rounded-xl text-[#0c1a17] font-cinzel text-[0.95rem] tracking-wider p-3 hover:brightness-110 active:translate-y-px disabled:opacity-60 cursor-pointer"
        >
          {busy === "create" ? "Se deschide…" : "➕ Deschide turnul"}
        </button>
      )}

      {mine && (
        <div className="bg-[#0c1a17] border-2 border-[#4a3a1c] rounded-xl p-3 flex flex-col gap-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[0.68rem] uppercase tracking-wider text-[#75938f]">
              Masa de start · {filled}/{SEATS}
            </span>
            <span
              className={`text-[0.65rem] uppercase tracking-wider px-2 py-0.5 rounded-full border ${
                live ? "text-[#8fd9a8] border-[#2f5b48] bg-[#0f211a]" : "text-[#e8c46a] border-[#4a3a1c] bg-[#1a1509]"
              }`}
            >
              {live ? "în joc" : "se strâng jucătorii"}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            {Array.from({ length: SEATS }).map((_, i) => {
              const name = mine.players[i];
              return (
                <div
                  key={i}
                  className={`flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-[0.78rem] ${
                    name ? "bg-[#122420] border-[#2c514c]" : "bg-[#050d0b] border-dashed border-[#1e3a34]"
                  }`}
                >
                  <span className={name ? "text-[#8fd9a8]" : "text-[#3f5c58]"}>{name ? "●" : "○"}</span>
                  <span className={`min-w-0 truncate ${name ? "text-[#cbdcda]" : "text-[#75938f] italic"}`}>
                    {name ?? "loc liber 👤"}
                  </span>
                </div>
              );
            })}
          </div>

          {live ? (
            <a
              href={`/tower/${mine.id}`}
              className="text-center bg-gradient-to-br from-[#d9a441] to-[#7d5a1c] border-2 border-[#d9a44160] rounded-lg text-[#10201b] font-cinzel text-[0.88rem] p-2.5 hover:brightness-110"
            >
              ▶ Continuă urcarea
            </a>
          ) : hosting ? (
            <>
              <button
                onClick={() => start(mine.id)}
                disabled={busy !== null}
                className="bg-gradient-to-br from-[#8fd9a8] to-[#3f8f63] border-2 border-[#8fd9a880] rounded-lg text-[#08201a] font-cinzel text-[0.95rem] tracking-wider p-2.5 hover:brightness-110 active:translate-y-px disabled:opacity-40 cursor-pointer"
              >
                {busy === "start" ? "Pornesc…" : "▶ Începe turnul"}
              </button>
              <div className="text-[#75938f] text-[0.7rem] text-center leading-snug">
                {filled > 1
                  ? `${filled} jucători la masă — restul locurilor le iau boții.`
                  : "Poți porni și singur: boții ocupă locurile libere."}
              </div>
            </>
          ) : (
            <div className="text-[#75938f] text-[0.72rem] text-center leading-snug">
              Ai un loc la masă. <span className="text-[#e8c46a]">{mine.hostName}</span> pornește turnul.
            </div>
          )}

          <button
            onClick={() => leave(mine.id)}
            disabled={busy !== null}
            className="text-[0.72rem] text-[#75938f] hover:text-[#c98b6b] disabled:opacity-50 cursor-pointer"
          >
            {hosting ? "✕ Închide turnul" : "✕ Dă-ți locul liber"}
          </button>
        </div>
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
            {mine ? "Nu e niciun alt turn deschis acum." : "Niciun turn deschis. Deschide unul."}
          </div>
        ) : (
          games.map((g) => (
            <div key={g.id} className="flex items-center justify-between gap-2 bg-[#050d0b] border border-[#1e3a34] rounded-xl p-2 pl-3">
              <span className="min-w-0">
                <span className="font-cinzel text-[#cbdcda] text-[0.85rem] truncate block">{g.hostName}</span>
                <span className="text-[#75938f] text-[0.65rem] truncate block">
                  {g.players.length ? g.players.join(", ") : "nimeni"} · {g.joined}/{SEATS} · {ago(g.createdAt)}
                </span>
              </span>
              <button
                onClick={() => join(g.id)}
                disabled={busy !== null}
                className="shrink-0 bg-gradient-to-br from-[#d9a441] to-[#7d5a1c] border-2 border-[#d9a44160] rounded-lg text-[#10201b] font-cinzel text-[0.78rem] px-3.5 py-1.5 hover:brightness-110 disabled:opacity-40 cursor-pointer"
              >
                {busy === g.id ? "Intru…" : "Intră"}
              </button>
            </div>
          ))
        )}
      </div>

      {mine && (
        <div className="text-[#75938f] text-[0.68rem] text-center leading-snug">
          Intri în alt turn? Îți dai locul din{" "}
          <span className="text-[#e8c46a]">{mine.hostName}</span> și cobori din tură.
        </div>
      )}

      {err && <div className="text-red-400 text-[0.75rem]">{err}</div>}
    </div>
  );
}
