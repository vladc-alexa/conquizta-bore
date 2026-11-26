"use client";

// "Cheamă jucători": while I'm in a waiting room, list who is online and let me
// ping any of them into my seat. One button per player, no modal, no typing.
import { useCallback, useEffect, useState } from "react";

type P = { id: string; name: string; online: boolean; where: string | null };

const TONE = {
  tower: {
    label: "Cheamă în turn",
    head: "text-[#9ec6c1] hover:text-[#dff0ec]",
    row: "border-[#1e3a34] bg-[#0a1614]",
    name: "text-[#d7e7e4]",
    btn: "bg-gradient-to-br from-[#d9a441] to-[#7d5a1c] text-[#10201b]",
    muted: "text-[#75938f]",
  },
  carciuma: {
    label: "Cheamă la masă",
    head: "text-[#e6cfae] hover:text-[#f7e6c6]",
    row: "border-[#33220f] bg-[#0b0702]",
    name: "text-[#f0dcbb]",
    btn: "bg-gradient-to-br from-[#c98b3f] to-[#7d4f16] text-[#1a1208]",
    muted: "text-[#8d755a]",
  },
} as const;

export default function InvitePlayers({
  kind,
  gameId,
  seatedNames,
  open: initialOpen = false,
}: {
  kind: "tower" | "carciuma";
  gameId: string;
  seatedNames: string[];
  open?: boolean;
}) {
  const tone = TONE[kind];
  const [open, setOpen] = useState(initialOpen);
  const [players, setPlayers] = useState<P[]>([]);
  const [sent, setSent] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/players", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setPlayers(data.players ?? []);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    load();
    const t = window.setInterval(load, 10_000);
    return () => window.clearInterval(t);
  }, [open, load]);

  const seated = new Set(seatedNames);
  const candidates = players.filter((p) => p.online && !seated.has(p.name)).slice(0, 8);

  const invite = async (id: string) => {
    setBusy(id);
    setErr("");
    try {
      const res = await fetch("/api/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, gameId, toId: id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setErr(data.error || "nu am putut trimite invitația");
      else setSent((s) => ({ ...s, [id]: true }));
    } catch {
      setErr("eroare de rețea");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`self-start text-[0.72rem] uppercase tracking-wider cursor-pointer ${tone.head}`}
      >
        {open ? "−" : "➕"} {tone.label}
      </button>

      {open && (
        <div className="flex flex-col gap-1.5">
          {candidates.length === 0 ? (
            <p className={`text-[0.72rem] ${tone.muted}`}>Nimeni online acum.</p>
          ) : (
            candidates.map((p) => (
              <div key={p.id} className={`flex items-center justify-between gap-2 rounded-lg border px-2 py-1 ${tone.row}`}>
                <span className={`min-w-0 truncate text-[0.8rem] ${tone.name}`}>
                  {p.name}
                  {p.where === "tower" ? " · în turn" : p.where === "carciuma" ? " · la masă" : ""}
                </span>
                <button
                  onClick={() => invite(p.id)}
                  disabled={busy !== null}
                  className={`shrink-0 rounded-md px-2.5 py-1 font-cinzel text-[0.72rem] disabled:opacity-40 cursor-pointer ${sent[p.id] ? "border border-current opacity-60 bg-transparent" : tone.btn}`}
                >
                  {busy === p.id ? "…" : sent[p.id] ? "trimis ✓" : "Invită"}
                </button>
              </div>
            ))
          )}
          {err && <p className="text-[0.72rem] text-red-400">{err}</p>}
        </div>
      )}
    </div>
  );
}
