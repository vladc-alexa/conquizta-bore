"use client";

// La Carciuma lobby: open a five-seat table or take a free chair. The host
// starts it; empty chairs are filled by locals who drink like professionals.
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import InvitePlayers from "@/components/InvitePlayers";

type OpenGame = { id: string; hostName: string; createdAt: string; joined: number; players: string[] };
type Mine = {
  id: string;
  status: string;
  role: "host" | "player";
  hostName: string;
  players: string[];
} | null;

const SEATS = 5;
const MIN_PLAYERS = 2;

function ago(iso: string) {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m`;
}

export default function CarciumaLobbyPanel({
  onUnauthorized,
  onClose,
}: {
  onUnauthorized?: () => void;
  onClose?: () => void;
}) {
  const router = useRouter();
  const [games, setGames] = useState<OpenGame[]>([]);
  const [mine, setMine] = useState<Mine>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const prev = useRef<{ id: string; status: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/carciuma/open", { cache: "no-store" });
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

  useEffect(() => {
    if (!mine) {
      prev.current = null;
      return;
    }
    const before = prev.current;
    if (before && before.id === mine.id && before.status === "WAITING" && mine.status === "IN_PROGRESS") {
      router.push(`/carciuma/${mine.id}`);
      return;
    }
    prev.current = { id: mine.id, status: mine.status };
  }, [mine, router]);

  async function create() {
    setBusy("create");
    setErr("");
    try {
      const r = await fetch("/api/carciuma", { method: "POST" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.gameId) setErr(d.error || "N-am putut deschide masa.");
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
      const r = await fetch(`/api/carciuma/${id}/join`, { method: "POST" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) setErr(d.error || "N-am putut lua loc la masă.");
      await load();
    } catch {
      setErr("Eroare de rețea.");
    }
    setBusy(null);
  }

  async function callBots(id: string, count = 1) {
    setBusy("bots");
    setErr("");
    try {
      const r = await fetch(`/api/carciuma/${id}/bots`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) setErr(d.error || "N-am putut chema localnicii.");
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
      const r = await fetch(`/api/carciuma/${id}/start`, { method: "POST" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErr(d.error || "N-am putut porni masa.");
        await load();
        return;
      }
      prev.current = { id, status: "IN_PROGRESS" };
      router.push(`/carciuma/${id}`);
    } catch {
      setErr("Eroare de rețea.");
    }
    setBusy(null);
  }

  async function leave(id: string) {
    setBusy("leave");
    setErr("");
    try {
      await fetch(`/api/carciuma/${id}/leave`, { method: "POST" });
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
        <h3 className="font-cinzel text-[#f0cf9a] text-[0.9rem] tracking-widest">🍺 La Carciuma</h3>
        <div className="flex items-center gap-2">
          <span className="text-[#9d7c56] text-[0.65rem]">5 SCAUNE · 3 PAHARE</span>
          {onClose && (
            <button onClick={onClose} title="Închide carciuma" className="text-[#9d7c56] hover:text-[#e2b877] cursor-pointer">
              ✕
            </button>
          )}
        </div>
      </div>

      {!mine && (
        <button
          onClick={create}
          disabled={busy !== null}
          className="bg-gradient-to-br from-[#c98b3f] to-[#7d4f16] border-2 border-[#e2b87760] rounded-xl text-[#1a1208] font-cinzel text-[0.95rem] tracking-wider p-3 hover:brightness-110 active:translate-y-px disabled:opacity-60 cursor-pointer"
        >
          {busy === "create" ? "Se deschide masa…" : "➕ Deschide o masă"}
        </button>
      )}

      {mine && (
        <div className="bg-[#150e06] border-2 border-[#4a2f12] rounded-xl p-3 flex flex-col gap-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[0.68rem] uppercase tracking-wider text-[#9d7c56]">
              Masa · {filled}/{SEATS}
            </span>
            <span
              className={`text-[0.65rem] uppercase tracking-wider px-2 py-0.5 rounded-full border ${
                live ? "text-[#8fd9a8] border-[#2f5b48] bg-[#0f211a]" : "text-[#e8c46a] border-[#4a3a1c] bg-[#1a1509]"
              }`}
            >
              {live ? "la masă" : "se strâng băutorii"}
            </span>
          </div>

          <div className="grid grid-cols-1 gap-1.5">
            {Array.from({ length: SEATS }).map((_, i) => {
              const name = mine.players[i];
              return (
                <div
                  key={i}
                  className={`flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-[0.78rem] ${
                    name ? "bg-[#211606] border-[#6b451f]" : "bg-[#0b0702] border-dashed border-[#33220f]"
                  }`}
                >
                  <span className={name ? "text-[#e2b877]" : "text-[#5d4830]"}>{name ? "●" : "○"}</span>
                  <span className={`min-w-0 truncate ${name ? "text-[#f0dcbb]" : "text-[#8d755a] italic"}`}>{name ?? "scaun liber 🪑"}</span>
                </div>
              );
            })}
          </div>

          {live ? (
            <a
              href={`/carciuma/${mine.id}`}
              className="text-center bg-gradient-to-br from-[#c98b3f] to-[#7d4f16] border-2 border-[#e2b87760] rounded-lg text-[#1a1208] font-cinzel text-[0.88rem] p-2.5 hover:brightness-110"
            >
              ▶ Înapoi la masă
            </a>
          ) : hosting ? (
            <>
              <button
                onClick={() => callBots(mine.id)}
                disabled={busy !== null || filled >= SEATS}
                className="bg-[#1d1208] border-2 border-[#6b451f] rounded-lg text-[#e8c46a] font-cinzel text-[0.82rem] tracking-wide p-2 hover:brightness-125 disabled:opacity-40 cursor-pointer"
              >
                {busy === "bots" ? "+1…" : "🎲 +1 localnic"}
              </button>
              <button
                onClick={() => callBots(mine.id, SEATS)}
                disabled={busy !== null || filled >= SEATS}
                className="bg-[#1d1208] border-2 border-[#6b451f] rounded-lg text-[#e8c46a] font-cinzel text-[0.82rem] tracking-wide p-2 hover:brightness-125 disabled:opacity-40 cursor-pointer"
              >
                {filled >= SEATS ? "Masa e plină" : `🎲 Umple masa (${SEATS - filled})`}
              </button>
              <button
                onClick={() => start(mine.id)}
                disabled={busy !== null || filled < MIN_PLAYERS}
                className="bg-gradient-to-br from-[#8fd9a8] to-[#3f8f63] border-2 border-[#8fd9a880] rounded-lg text-[#08201a] font-cinzel text-[0.95rem] tracking-wider p-2.5 hover:brightness-110 active:translate-y-px disabled:opacity-40 cursor-pointer"
              >
                {busy === "start" ? "Pornesc…" : "▶ Începe băutura"}
              </button>
              <div className="text-[#9d7c56] text-[0.7rem] text-center leading-snug">
                {filled < MIN_PLAYERS ? `Mai e nevoie de ${MIN_PLAYERS - filled} jucător — cheamă localnici sau așteaptă pe cineva.` : `${filled} la masă. Poți porni.`}
              </div>
            </>
          ) : (
            <div className="text-[#9d7c56] text-[0.72rem] text-center leading-snug">
              Ai un scaun. <span className="text-[#e8c46a]">{mine.hostName}</span> pornește runda.
            </div>
          )}

          <InvitePlayers kind="carciuma" gameId={mine.id} seatedNames={mine.players} />

          <button
            onClick={() => leave(mine.id)}
            disabled={busy !== null}
            className="text-[0.72rem] text-[#9d7c56] hover:text-[#e08b6b] disabled:opacity-50 cursor-pointer"
          >
            {hosting ? "✕ Închide masa" : "✕ Dă-ți scaunul liber"}
          </button>
        </div>
      )}

      <div className="flex items-center justify-between text-[0.7rem] text-[#9d7c56] pt-1">
        <span className="uppercase tracking-wider">Mese deschise</span>
        <button onClick={load} className="hover:text-[#e2b877] cursor-pointer" title="Reîmprospătează">
          ⟳
        </button>
      </div>

      <div className="flex flex-col gap-1.5">
        {games.length === 0 ? (
          <div className="text-[#8d755a] text-[0.78rem] text-center p-4 border border-dashed border-[#33220f] rounded-xl">
            {mine ? "Nicio altă masă deschisă." : "Carciuma e goală. Deschide tu masa."}
          </div>
        ) : (
          games.map((g) => (
            <div key={g.id} className="flex items-center justify-between gap-2 bg-[#0b0702] border border-[#33220f] rounded-xl p-2 pl-3">
              <span className="min-w-0">
                <span className="font-cinzel text-[#f0dcbb] text-[0.85rem] truncate block">{g.hostName}</span>
                <span className="text-[#8d755a] text-[0.65rem] truncate block">
                  {g.players.length ? g.players.join(", ") : "nimeni"} · {g.joined}/{SEATS} · {ago(g.createdAt)}
                </span>
              </span>
              <button
                onClick={() => join(g.id)}
                disabled={busy !== null}
                className="shrink-0 bg-gradient-to-br from-[#c98b3f] to-[#7d4f16] border-2 border-[#e2b87760] rounded-lg text-[#1a1208] font-cinzel text-[0.78rem] px-3.5 py-1.5 hover:brightness-110 disabled:opacity-40 cursor-pointer"
              >
                {busy === g.id ? "Intru…" : "Ia loc"}
              </button>
            </div>
          ))
        )}
      </div>

      {err && <div className="text-red-400 text-[0.75rem]">{err}</div>}
    </div>
  );
}
