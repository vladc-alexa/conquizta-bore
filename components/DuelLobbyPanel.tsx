"use client";

// The 1 la 1 lobby. Create a match and stay right here: the seat list fills in
// as someone joins, and the host presses Start on this card. Nobody is sent to a
// separate waiting page any more — both players sit in the lobby until the match
// actually opens, then the panel jumps into the game.
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type OpenGame = { id: string; hostName: string; createdAt: string; mine: boolean };
type Mine = {
  id: string;
  status: string;
  role: "host" | "guest";
  hostName: string;
  guestName: string | null;
} | null;

function ago(iso: string) {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m`;
}

function Seat({ name, me, empty }: { name?: string | null; me?: boolean; empty?: string }) {
  return (
    <div
      className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 text-[0.82rem] ${
        name ? "bg-[#122420] border-[#2c514c]" : "bg-[#050d0b] border-dashed border-[#1e3a34]"
      }`}
    >
      <span className={name ? "text-[#8fd9a8]" : "text-[#3f5c58]"}>{name ? "●" : "○"}</span>
      <span className={`min-w-0 truncate ${name ? "text-[#cbdcda]" : "text-[#75938f] italic"}`}>
        {name ?? empty ?? "loc liber"}
      </span>
      {me && <span className="ml-auto shrink-0 text-[0.65rem] text-[#9ec6c1] uppercase tracking-wider">tu</span>}
    </div>
  );
}

export default function DuelLobbyPanel({ onUnauthorized }: { onUnauthorized?: () => void }) {
  const router = useRouter();
  const [games, setGames] = useState<OpenGame[]>([]);
  const [mine, setMine] = useState<Mine>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");
  // remember the last state we saw, so we push into the game only when it flips
  // from waiting to running (not every time the dashboard is opened)
  const prev = useRef<{ id: string; status: string } | null>(null);

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
      router.push(`/duel/${mine.id}`);
      return;
    }
    prev.current = { id: mine.id, status: mine.status };
  }, [mine, router]);

  async function create() {
    setBusy("create");
    setErr("");
    try {
      const r = await fetch("/api/duel", { method: "POST" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.duelId) setErr(d.error || "N-am putut crea meciul.");
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
      const r = await fetch(`/api/duel/${id}/join`, { method: "POST" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) setErr(d.error || "N-am putut intra în meci.");
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
      const r = await fetch(`/api/duel/${id}/start`, { method: "POST" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErr(d.error || "N-am putut porni meciul.");
        await load();
        return;
      }
      prev.current = { id, status: "IN_PROGRESS" };
      router.push(`/duel/${id}`);
    } catch {
      setErr("Eroare de rețea.");
    }
    setBusy(null);
  }

  async function cancel(id: string) {
    setBusy("cancel");
    setErr("");
    try {
      await fetch(`/api/duel/${id}/leave`, { method: "POST" });
      prev.current = null;
      await load();
    } catch {
      setErr("Eroare de rețea.");
    }
    setBusy(null);
  }

  const waiting = mine?.status === "WAITING";
  const hosting = waiting && mine?.role === "host";
  const ready = hosting && !!mine?.guestName;
  const live = mine?.status === "IN_PROGRESS";
  // my own open table is rendered above; the list is for other people's lobbies
  const others = games.filter((g) => !g.mine);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-cinzel text-[#9ec6c1] text-[0.9rem] tracking-widest">⚔️ 1 la 1</h3>
        <span className="text-[#75938f] text-[0.65rem] uppercase tracking-wider">doi jucători · 10 runde</span>
      </div>

      {!mine && (
        <button
          onClick={create}
          disabled={busy !== null}
          className="bg-gradient-to-br from-[#9ec6c1] to-[#6f9c99] border-2 border-[#9ec6c180] rounded-xl text-[#0c1a17] font-cinzel text-[0.95rem] tracking-wider p-3 hover:brightness-110 active:translate-y-px disabled:opacity-60 cursor-pointer"
        >
          {busy === "create" ? "Se creează…" : "➕ Creează meci"}
        </button>
      )}

      {mine && (
        <div className="bg-[#0c1a17] border-2 border-[#2c514c] rounded-xl p-3 flex flex-col gap-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[0.68rem] uppercase tracking-wider text-[#75938f]">Masa ta</span>
            <span
              className={`text-[0.65rem] uppercase tracking-wider px-2 py-0.5 rounded-full border ${
                ready || live
                  ? "text-[#8fd9a8] border-[#2f5b48] bg-[#0f211a]"
                  : "text-[#e8c46a] border-[#4a3a1c] bg-[#1a1509]"
              }`}
            >
              {live ? "în joc" : ready ? "gata de start" : "aștept adversar"}
            </span>
          </div>

          <div className="flex flex-col gap-1.5">
            <Seat name={mine.hostName} me={mine.role === "host"} />
            {mine.guestName ? (
              <Seat name={mine.guestName} me={mine.role === "guest"} />
            ) : (
              <Seat empty="loc liber — intră cineva din lista de mai jos" />
            )}
          </div>

          {live ? (
            <a
              href={`/duel/${mine.id}`}
              className="text-center bg-gradient-to-br from-[#6f9c99] to-[#2c514c] border-2 border-[#9ec6c160] rounded-lg text-[#e2eeeb] font-cinzel text-[0.88rem] p-2.5 hover:brightness-110"
            >
              ▶ Continuă meciul
            </a>
          ) : hosting ? (
            <>
              <button
                onClick={() => start(mine.id)}
                disabled={!ready || busy !== null}
                className="bg-gradient-to-br from-[#8fd9a8] to-[#3f8f63] border-2 border-[#8fd9a880] rounded-lg text-[#08201a] font-cinzel text-[0.95rem] tracking-wider p-2.5 hover:brightness-110 active:translate-y-px disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                {busy === "start" ? "Pornesc…" : "▶ Începe meciul"}
              </button>
              <div className="text-[#75938f] text-[0.7rem] text-center leading-snug">
                {ready ? `${mine.guestName} e la masă — pornește când ești gata.` : "Butonul se activează când se așază al doilea jucător."}
              </div>
            </>
          ) : (
            <div className="text-[#75938f] text-[0.72rem] text-center leading-snug">
              Ai locul luat. <span className="text-[#9ec6c1]">{mine.hostName}</span> pornește meciul de la masă.
            </div>
          )}

          <button
            onClick={() => cancel(mine.id)}
            disabled={busy !== null}
            className="text-[0.72rem] text-[#75938f] hover:text-[#c98b6b] disabled:opacity-50 cursor-pointer"
          >
            {hosting ? "✕ Anulează masa" : "✕ Ridică-te de la masă"}
          </button>
        </div>
      )}

      <div className="flex items-center justify-between text-[0.7rem] text-[#75938f] pt-1">
        <span className="uppercase tracking-wider">Meciuri deschise</span>
        <button onClick={load} className="hover:text-[#9ec6c1] cursor-pointer" title="Reîmprospătează">
          ⟳
        </button>
      </div>

      <div className="flex flex-col gap-1.5">
        {others.length === 0 ? (
          <div className="text-[#75938f] text-[0.78rem] text-center p-4 border border-dashed border-[#1e3a34] rounded-xl">
            {mine ? "Nu e nimeni altcineva la masă acum." : "Niciun meci deschis. Creează unul."}
          </div>
        ) : (
          others.map((g) => (
            <div
              key={g.id}
              className="flex items-center justify-between gap-2 bg-[#050d0b] border border-[#1e3a34] rounded-xl p-2 pl-3"
            >
              <span className="min-w-0">
                <span className="font-cinzel text-[#cbdcda] text-[0.85rem] truncate block">{g.hostName}</span>
                <span className="text-[#75938f] text-[0.65rem]">deschis de {ago(g.createdAt)}</span>
              </span>
              <button
                onClick={() => join(g.id)}
                disabled={busy !== null || !!mine}
                className="shrink-0 bg-gradient-to-br from-[#6f9c99] to-[#2c514c] border-2 border-[#9ec6c160] rounded-lg text-[#e2eeeb] font-cinzel text-[0.78rem] px-3.5 py-1.5 hover:brightness-110 disabled:opacity-40 cursor-pointer"
              >
                {busy === g.id ? "Intru…" : "Așază-te"}
              </button>
            </div>
          ))
        )}
      </div>

      {err && <div className="text-red-400 text-[0.75rem]">{err}</div>}
    </div>
  );
}
