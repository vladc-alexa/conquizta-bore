"use client";

// The tower itself: 8 ladders up a stone wall, one climber per ladder.
// Purely presentational — heights come from the server (rungs climbed).
import type { TowerStatePlayer } from "@/lib/tower";

// running-bond masonry tile for the wall
const BRICK =
  `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='84' height='40'>` +
  `<path d='M0 0H84M0 20H84M42 0V20M0 20V40M84 20V40' stroke='%2306110e' stroke-width='2' stroke-opacity='0.55'/></svg>")`;

const SEAT_COLORS = [
  "#9ec6c1", "#d9a441", "#7fa8a5", "#c98b6b", "#8fb0d9", "#c78fb0", "#a8c98f", "#b9a17f",
];

export default function Tower({
  players,
  height,
  winnerId,
  eliminatedId,
  heightPx = 460,
}: {
  players: TowerStatePlayer[];
  height: number;
  winnerId: string | null;
  eliminatedId: string | null;
  heightPx?: number;
}) {
  const seats = Array.from({ length: 8 }, (_, i) => players.find((p) => p.seat === i) ?? null);
  const climbPx = heightPx - 96; // keep feet/top inside the wall

  return (
    <div
      className="relative w-full overflow-hidden rounded-xl border-2 border-[#1e3a34] shadow-2xl"
      style={{
        height: heightPx,
        background:
          "linear-gradient(180deg,#0a1512 0%,#12241f 12%,#16261f 55%,#0d1a15 100%)",
      }}
      aria-label="Turnul"
    >
      {/* stone wall: running-bond masonry, lit from above, dark at the base */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: [
            "radial-gradient(ellipse at 50% 0%, rgba(206,236,228,0.10), transparent 62%)",
            "radial-gradient(ellipse at 50% 105%, rgba(0,0,0,0.6), transparent 62%)",
            BRICK,
            "linear-gradient(180deg,#33514a 0%,#25403a 45%,#172a24 100%)",
          ].join(","),
          backgroundSize: "auto,auto,84px 40px,auto",
        }}
      />
      {/* ivy */}
      <div
        className="absolute inset-y-0 left-0 w-10 opacity-30"
        style={{ background: "linear-gradient(90deg,#2f6b4a,transparent)" }}
      />
      <div
        className="absolute inset-y-0 right-0 w-8 opacity-20"
        style={{ background: "linear-gradient(270deg,#2f6b4a,transparent)" }}
      />

      {/* crenellations: merlons with gaps, then the parapet walk below them */}
      <div
        className="absolute inset-x-0 top-0 h-6"
        style={{
          backgroundImage:
            "repeating-linear-gradient(90deg,#3a5b52 0 30px,rgba(0,0,0,0) 30px 48px)",
          filter: "drop-shadow(0 2px 3px rgba(0,0,0,.6))",
        }}
      />
      <div
        className="absolute inset-x-0 top-6 h-2"
        style={{ background: "linear-gradient(180deg,#2a453d,#16281f)" }}
      />
      {/* the treasure everyone is climbing for */}
      <div className="absolute inset-x-0 top-7 flex justify-center text-[1.35rem] drop-shadow-lg">🏆</div>

      {/* ladders */}
      {seats.map((p, i) => {
        const left = `${((i + 0.5) / 8) * 100}%`;
        return (
          <div key={`ladder-${i}`} className="absolute top-14 bottom-10" style={{ left }}>
            {/* rails (lit on the left, shadowed on the right) */}
            <div
              className="absolute -left-2 top-0 bottom-0 w-[3px]"
              style={{ background: "linear-gradient(90deg,#9a713f,#5d4021)" }}
            />
            <div
              className="absolute left-2 top-0 bottom-0 w-[3px]"
              style={{ background: "linear-gradient(90deg,#6b4a2a,#3f2a13)" }}
            />
            {/* rungs */}
            <div
              className="absolute -left-2 w-4 top-0 bottom-0 opacity-70"
              style={{
                background:
                  "repeating-linear-gradient(180deg,#8a6136 0 3px,transparent 3px 20px)",
              }}
            />
            {/* climber */}
            {p && (
              <div
                className="absolute -translate-x-1/2 flex flex-col items-center transition-all duration-700 ease-out"
                style={{
                  bottom: `${(Math.min(p.rungs, height) / height) * 100}%`,
                  left: 0,
                  opacity: p.eliminated ? 0.45 : 1,
                }}
              >
                <div
                  className="w-7 h-7 rounded-full border-2 flex items-center justify-center text-[0.7rem] font-bold text-[#08110e] shadow-lg"
                  style={{
                    background: SEAT_COLORS[i],
                    borderColor: p.id === winnerId ? "#e8c46a" : "#0b1a16",
                    boxShadow: p.id === winnerId ? "0 0 12px #e8c46a" : undefined,
                  }}
                  title={`${p.name} · ${p.score} pct · ${p.rungs} trepte`}
                >
                  {p.name.slice(0, 1).toUpperCase()}
                </div>
                <span className="mt-0.5 rounded bg-[#050d0b]/70 px-1 py-[1px] text-[0.6rem] leading-none text-[#dfeeeb] whitespace-nowrap">
                  {p.name.length > 9 ? `${p.name.slice(0, 9)}…` : p.name}
                  {p.id === winnerId ? " 👑" : p.eliminated ? " 💀" : ""}
                </span>
              </div>
            )}
          </div>
        );
      })}

      {/* ground: grass meeting the wall, darker at the foot */}
      <div
        className="absolute inset-x-0 bottom-0 h-12"
        style={{
          background:
            "linear-gradient(180deg, rgba(8,18,14,0) 0%, rgba(8,18,14,0.85) 45%, #0a1712 100%)",
        }}
      />
      <div
        className="absolute inset-x-0 bottom-0 h-3"
        style={{ background: "linear-gradient(180deg,#2f5b3f,#16301f)" }}
      />
      {eliminatedId && (
        <div className="absolute bottom-1 inset-x-0 text-center text-[0.65rem] text-[#c98b6b]">
          💀 ultimul clasat a căzut de pe scară
        </div>
      )}
    </div>
  );
}
