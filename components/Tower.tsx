"use client";

// The tower itself: the illustrated tower wall with 8 ladders, one climber per
// ladder. Climbers sit at their measured ladder x-position and rise with the
// rungs they've climbed, so the artwork and the game agree.
//
// Art: `public/tower/tower.jpg`, sprite slots in `components/towerSprites.ts`.
// Without sprites a climber renders as a gem-coloured pawn — same anchor, same
// behaviour, so art can land later without touching the game.
import type { TowerStatePlayer } from "@/lib/tower";
import { CLIMB_BASE, CLIMB_TOP, CLIMBER_SPRITES, LADDER_X } from "./towerSprites";

const SEAT_COLORS = [
  "#e0b34a",
  "#7fb2e0",
  "#c98be0",
  "#6fd0a0",
  "#e08a8a",
  "#9ec6c1",
  "#e0c27f",
  "#a0a8e0",
];

const SEAT_LABELS = ["V", "B", "I", "M", "R", "A", "E", "C"];

/** how many rungs it takes to reach the summit (must match lib/tower.ts) */
const SUMMIT_RUNGS = 36;

export default function Tower({ players }: { players: TowerStatePlayer[] }) {
  const ordered = [...players].sort((a, b) => a.seat - b.seat);

  return (
    <div
      className="relative w-full overflow-hidden rounded-2xl border-2 border-[#1e3a34] shadow-2xl select-none"
      style={{ aspectRatio: "1024 / 572", containerType: "size" }}
    >
      {/* artwork */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/tower/tower.jpg"
        alt="Turnul — zidul cu 8 scări"
        className="absolute inset-0 h-full w-full object-cover"
        draggable={false}
      />

      {/* climbers */}
      {ordered.map((p) => {
        const seat = p.seat % 8;
        const xPct = LADDER_X[seat] ?? 0.5;
        const climbed = Math.min(1, Math.max(0, p.rungs / SUMMIT_RUNGS));
        const bottomPct = CLIMB_BASE - climbed * (CLIMB_BASE - CLIMB_TOP);
        const sprite = CLIMBER_SPRITES[seat] ?? null;
        const color = SEAT_COLORS[seat];

        return (
          <div
            key={p.id}
            className="absolute flex flex-col items-center transition-all duration-700 ease-out"
            style={{
              left: `${xPct * 100}%`,
              bottom: `${bottomPct * 100}%`,
              transform: `translate(-50%, ${p.eliminated ? "8px" : "4px"}) rotate(${p.eliminated ? -70 : 0}deg)`,
              opacity: p.eliminated ? 0.75 : 1,
              zIndex: p.mine ? 30 : 20,
            }}
            title={`${p.name}${p.isBot ? " (bot)" : ""} — ${p.rungs} trepte · ${p.score} pct`}
          >
            {p.rungs >= SUMMIT_RUNGS && !p.eliminated && (
              <div className="leading-none text-[0.7rem] mb-[1px] drop-shadow">👑</div>
            )}
            {sprite ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={p.eliminated && sprite.fall ? sprite.fall : sprite.src}
                alt={p.name}
                draggable={false}
                style={{
                  height: `${(12.5 * (sprite.scale ?? 1)).toFixed(2)}cqh`,
                  width: "auto",
                }}
                className="drop-shadow-[0_2px_3px_rgba(0,0,0,.55)]"
              />
            ) : (
              <div
                className="flex aspect-square items-center justify-center rounded-full border-2 font-cinzel"
                style={{
                  height: "8cqh",
                  background: `radial-gradient(circle at 32% 28%, ${color}, #0e211c 78%)`,
                  borderColor: p.mine ? "#f4e5b8" : "#0b1a16",
                  color: "#06120f",
                  boxShadow: "0 2px 4px rgba(0,0,0,.55)",
                  fontSize: "3.1cqh",
                }}
              >
                {SEAT_LABELS[seat]}
              </div>
            )}
            <span
              className="mt-[1px] whitespace-nowrap rounded bg-[#040a08]/70 px-1 text-[0.55rem] leading-[1.15] text-[#e6f1ee]"
              style={p.mine ? { color: "#ffe9a8" } : undefined}
            >
              {p.name}
              {p.eliminated ? " 💀" : ""}
            </span>
          </div>
        );
      })}

      {/* summit marker: only once someone is king */}
      {ordered.some((p) => p.rungs >= SUMMIT_RUNGS) && (
        <div className="pointer-events-none absolute inset-x-0 top-[6%] flex justify-center">
          <span className="rounded-full bg-[#040a08]/70 px-3 py-1 font-cinzel text-[0.7rem] tracking-widest text-[#ffe9a8]">
            👑 CUCERITOR
          </span>
        </div>
      )}
    </div>
  );
}
