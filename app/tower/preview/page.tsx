"use client";

// Dev-only art harness: renders the tower board with a fixed set of climbers so
// the sprite anchoring, the climb loop and the new board art can be eyeballed
// (and screenshotted) without a database, a lobby or a live round. Not linked
// from the game.
//
// It mirrors the real /tower/[id] layout (same container width + grid columns)
// so a screenshot here shows the board at the size players actually get.
// Every 3s one climber gains a rung, which is the only case that should start
// the walk animation — everyone else must stay frozen.
import { useEffect, useState } from "react";
import Tower from "@/components/Tower";
import type { TowerStatePlayer } from "@/lib/tower";

const NAMES = [
  "Cavalerul",
  "Arcașul",
  "Pitic",
  "Magul",
  "Băiatul",
  "Ticălosul",
  "Cărturarul",
  "Mercenarul",
];

const RUNGS = [0, 4, 8, 12, 16, 20, 26, 36];

const seed: TowerStatePlayer[] = NAMES.map((name, seat) => ({
  id: `seat-${seat}`,
  name,
  seat,
  score: 40 + seat * 7,
  rungs: RUNGS[seat],
  eliminated: seat === 6,
  fellRound: seat === 6 ? 7 : null,
  isBot: seat % 2 === 1,
  mine: seat === 3,
}));

export default function TowerPreview() {
  const [players, setPlayers] = useState<TowerStatePlayer[]>(seed);

  useEffect(() => {
    let turn = 0;
    const t = setInterval(() => {
      const seat = turn % 5; // only the live climbers 0..4 move
      turn += 1;
      setPlayers((ps) =>
        ps.map((p) => (p.seat === seat ? { ...p, rungs: Math.min(36, p.rungs + 3) } : p)),
      );
    }, 3000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="w-full max-w-[1700px] px-3">
      <h1 className="mb-2 font-cinzel text-sm tracking-widest text-[#9ec6c1]">
        TURNUL · PREVIEW ARTĂ (fără DB) — un urcător primește trepte la fiecare 3s
      </h1>
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(310px,340px)] gap-4 items-start">
        <Tower players={players} />
        <div className="rounded-2xl border-2 border-[#1e3a34] bg-[#0c1a17] p-4 text-[0.8rem] text-[#75938f]">
          panou lateral (întrebare + scară) — placeholder în preview
        </div>
      </div>
    </div>
  );
}
