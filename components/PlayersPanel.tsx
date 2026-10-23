"use client";

// "Jucători înregistrați" — the roster box that sits to the right of the Turnul
// card: every account, who is online right now, and who is already at a table.
import { useCallback, useEffect, useState } from "react";

type Player = {
  id: string;
  name: string;
  color: string | null;
  online: boolean;
  where: "tower" | "carciuma" | null;
  joined: string;
};

export default function PlayersPanel({ onClose }: { onClose?: () => void }) {
  const [players, setPlayers] = useState<Player[]>([]);
  const [me, setMe] = useState<string | null>(null);
  const [open, setOpen] = useState(true);
  const [showOffline, setShowOffline] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/players", { cache: "no-store" });
      if (!r.ok) return;
      const d = await r.json();
      setPlayers(d.players ?? []);
      setMe(d.me ?? null);
    } catch {
      /* keep the last roster */
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);

  const onlineList = players.filter((p) => p.online);
  const offlineList = players.filter((p) => !p.online);
  const online = onlineList.length;
  const shown = showOffline ? [...onlineList, ...offlineList] : onlineList;

  return (
    <div className="flex flex-col gap-2 min-h-0">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-cinzel text-[#9ec6c1] text-[0.82rem] tracking-widest">👥 Jucători</h3>
        <div className="flex items-center gap-1.5">
          <span className="rounded-full border border-[#2c514c] bg-[#0f211a] px-1.5 py-0.5 text-[0.6rem] text-[#8fd9a8]">{online} online</span>
          {onClose && (
            <button onClick={onClose} title="Închide lista" className="text-[#75938f] hover:text-[#9ec6c1] cursor-pointer">
              ✕
            </button>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between text-[0.62rem] text-[#75938f]">
        <span>{players.length} înregistrați</span>
        <button onClick={() => setOpen((v) => !v)} className="hover:text-[#9ec6c1] cursor-pointer">
          {open ? "strânge" : "desfă"}
        </button>
      </div>

      <button
        onClick={() => setShowOffline((v) => !v)}
        className="self-start text-[0.64rem] text-[#75938f] hover:text-[#9ec6c1] cursor-pointer"
      >
        {showOffline ? "▾ ascunde jucătorii offline" : `▸ arată jucătorii offline (${offlineList.length})`}
      </button>

      <div className={`overflow-y-auto pr-0.5 ${open ? "max-h-[268px]" : "max-h-0 overflow-hidden"}`}>
        <ul className="flex flex-col gap-1">
          {shown.map((p) => (
            <li
              key={p.id}
              className="flex items-center gap-1.5 rounded-lg border border-[#1e3a34] bg-[#050d0b] px-2 py-1 text-[0.76rem]"
              title={`înscris ${new Date(p.joined).toLocaleDateString("ro-RO")}`}
            >
              <span className={`text-[0.6rem] ${p.online ? "text-[#8fd9a8]" : "text-[#3f5c58]"}`}>●</span>
              <span className="min-w-0 truncate" style={{ color: p.color || "#cbdcda" }}>
                {p.name}
              </span>
              {p.id === me && <span className="shrink-0 text-[0.55rem] uppercase tracking-wider text-[#9ec6c1]">tu</span>}
              {p.where && (
                <span className="ml-auto shrink-0 text-[0.55rem] uppercase tracking-wider text-[#e2b877]" title={p.where === "tower" ? "în Turnul" : "la Carciuma"}>
                  {p.where === "tower" ? "🏰" : "🍺"}
                </span>
              )}
            </li>
          ))}
          {!players.length && <li className="text-[#75938f] text-[0.72rem] text-center p-3">Se încarcă…</li>}
          {!!players.length && !shown.length && (
            <li className="text-[#75938f] text-[0.72rem] text-center p-2">Nimeni online acum.</li>
          )}
        </ul>
      </div>
    </div>
  );
}
