"use client";

// The tower itself: the illustrated tower wall with 8 ladders, one climber per
// ladder. Climbers sit at their measured ladder x-position and rise with the
// rungs they've climbed, so the artwork and the game agree.
//
// Art: `public/tower/tower.jpg`, sprite slots in `components/towerSprites.ts`.
// Without sprites a climber renders as a gem-coloured pawn — same anchor, same
// behaviour, so art can land later without touching the game.
import { useEffect, useRef, useState } from "react";
import type { TowerStatePlayer } from "@/lib/tower";
import { CLIMB_GROUND, CLIMB_TOP, CLIMBER_SPRITES, LADDER_X } from "./towerSprites";

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

/** how long a climber keeps the walk loop after gaining rungs (matches the
 *  700ms slide transition + a couple of steps) */
const STEP_MS = 1400;

export default function Tower({
  players,
  rocks = [],
}: {
  players: TowerStatePlayer[];
  /** rocks thrown this round (server-owned) — replayed as an animation */
  rocks?: { throwerId: string; targetId: string; at: number }[];
}) {
  const ordered = [...players].sort((a, b) => a.seat - b.seat);

  // Climbers only walk while they are actually gaining rungs. The board polls
  // every 1.5s, so without this every sprite loops the walk cycle forever —
  // including at 0 rungs, which reads as "they're all climbing already".
  const prevRungs = useRef<Record<string, number>>({});
  const [walking, setWalking] = useState<Record<string, boolean>>({});

  // --- rocks thrown by real players ---------------------------------------
  // The server keeps the hits (two on the same climber cost a rung); the board
  // only replays the flight: thrower → target, then a flinch.
  const [hitId, setHitId] = useState<string | null>(null);
  const [throwingId, setThrowingId] = useState<string | null>(null);
  const [rock, setRock] = useState({ x: 0, y: 0, spin: 0, on: false });
  const seenRocks = useRef<string>("");
  const flying = useRef(false);

  useEffect(() => {
    const latest = rocks[rocks.length - 1];
    if (!latest) return;
    const key = `${latest.at}:${latest.throwerId}:${latest.targetId}`;
    if (seenRocks.current === key || flying.current) return;
    const thrower = players.find((p) => p.id === latest.throwerId);
    const target = players.find((p) => p.id === latest.targetId);
    if (!thrower || !target) return;
    seenRocks.current = key;
    flying.current = true;

    const xOf = (p: TowerStatePlayer) => (LADDER_X[p.seat % 8] ?? 0.5) * 100;
    const yOf = (p: TowerStatePlayer) =>
      (CLIMB_GROUND + Math.min(1, p.rungs / SUMMIT_RUNGS) * (CLIMB_TOP - CLIMB_GROUND)) * 100;
    const x0 = xOf(thrower);
    const y0 = yOf(thrower) + 4;
    const x1 = xOf(target);
    const y1 = yOf(target) + 3;

    setThrowingId(thrower.id);
    // safety net: a backgrounded tab throttles rAF, so never leave the throw
    // face stuck on screen if the frames stop coming
    window.setTimeout(() => {
      flying.current = false;
      setThrowingId(null);
    }, 1500);
    const t0 = performance.now();
    const DUR = 640;
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / DUR);
      setRock({
        x: x0 + (x1 - x0) * p,
        y: y0 + (y1 - y0) * p + Math.sin(Math.PI * p) * 6,
        spin: p * 720,
        on: true,
      });
      if (p < 1) return;
      setRock((r) => ({ ...r, on: false }));
      setThrowingId(null);
      setHitId(target.id);
      flying.current = false;
      window.setTimeout(() => setHitId(null), 900);
    };
    const timer = window.setInterval(() => step(performance.now()), 40);
    window.setTimeout(() => window.clearInterval(timer), DUR + 200);
    // players/answers are polled every 1.5s; the throw keys off the answer row
    // itself, so a re-render mid-flight must not restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rocks]);


  useEffect(() => {
    const gained: string[] = [];
    for (const p of players) {
      const before = prevRungs.current[p.id];
      if (before !== undefined && p.rungs > before) gained.push(p.id);
      prevRungs.current[p.id] = p.rungs;
    }
    if (gained.length === 0) return;
    setWalking((w) => {
      const next = { ...w };
      for (const id of gained) next[id] = true;
      return next;
    });
    const t = window.setTimeout(() => {
      setWalking((w) => {
        const next = { ...w };
        for (const id of gained) delete next[id];
        return next;
      });
    }, STEP_MS);
    return () => window.clearTimeout(t);
  }, [players]);

  /** Which painted face a climber wears right now. */
  const expressionFor = (p: TowerStatePlayer): "calm" | "tongue" | "frown" | "yawn" | "throw" => {
    if (throwingId === p.id) return "tongue"; // tongue out while he lobs the rock
    if (hitId === p.id) return "frown"; // grimace when the rock lands
    if (p.eliminated) return "frown";
    return "calm";
  };

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
        // 0 rungs = ladder foot (bottom of the board), 36 rungs = wall top.
        // A fallen climber drops all the way to the ground (transition-all slides
        // them down instead of leaving them stuck on the wall edge).
        const climbed = p.eliminated ? 0 : Math.min(1, Math.max(0, p.rungs / SUMMIT_RUNGS));
        const bottomPct = CLIMB_GROUND + climbed * (CLIMB_TOP - CLIMB_GROUND);
        const sprite = CLIMBER_SPRITES[seat] ?? null;
        const color = SEAT_COLORS[seat];
        // climb loop only for the moment they gained rungs; the eliminated
        // pose is a fall frame and the winner holds still at the summit.
        const climbing = !p.eliminated && p.rungs < SUMMIT_RUNGS && !!walking[p.id];

        // the anchor is the climber's feet: sprite sits on it, the name tag is
        // absolutely positioned under it so it never shifts the climb position.
        // Tags alternate between two rows — eight ladders are only ~55px apart,
        // so a single row of names collides as soon as everyone is at 0 rungs.
        return (
          <div
            key={p.id}
            className={`absolute transition-all duration-700 ease-out${hitId === p.id ? " climber-hit" : ""}`}
            style={{
              left: `${xPct * 100}%`,
              bottom: `${bottomPct * 100}%`,
              transform: `translate(-50%, ${p.eliminated ? "10px" : "0px"}) rotate(${p.eliminated ? -70 : 0}deg)`,
              opacity: p.eliminated ? 0.75 : 1,
              zIndex: p.mine ? 30 : 20,
            }}
            title={`${p.name}${p.isBot ? " (bot)" : ""} — ${p.rungs} trepte · ${p.score} pct`}
          >
            {p.rungs >= SUMMIT_RUNGS && !p.eliminated && (
              <div
                className="absolute inset-x-0 -top-[1.05em] text-center leading-none drop-shadow"
                style={{ fontSize: "clamp(12px, 2.1cqh, 20px)" }}
              >
                👑
              </div>
            )}
            {sprite ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={
                  p.eliminated
                    ? sprite.fall
                    : sprite[expressionFor(p) === "calm" ? "calm" : expressionFor(p)]
                }
                alt={p.name}
                draggable={false}
                style={{
                  height: `${(12.5 * (sprite.scale ?? 1)).toFixed(2)}cqh`,
                  width: "auto",
                  animationDelay: climbing ? `${(seat * 0.09).toFixed(2)}s` : undefined,
                }}
                className={`block drop-shadow-[0_2px_3px_rgba(0,0,0,.55)]${
                  climbing ? " climber-sprite" : " climber-sprite--held"
                }`}
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
              className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-[#040a08]/75 px-1 leading-[1.15] text-[#e6f1ee]"
              style={{
                fontSize: "clamp(10px, 1.9cqh, 16px)",
                top: `${p.eliminated ? 100 : 96}%`,
                marginTop: seat % 2 === 1 ? "1.35em" : "0.15em",
                ...(p.mine ? { color: "#ffe9a8" } : null),
              }}
            >
              {p.name}
              {p.eliminated ? " 💀" : ""}
            </span>
          </div>
        );
      })}

      {/* cosmetic rock in flight */}
      <div
        className="rock"
        style={{
          left: `${rock.x}%`,
          top: `${100 - rock.y}%`,
          opacity: rock.on ? 1 : 0,
          transform: `translate(-50%, -50%) rotate(${rock.spin}deg)`,
          zIndex: 40,
        }}
      />

      {/* summit marker: only once someone is king */}
      {ordered.some((p) => p.rungs >= SUMMIT_RUNGS) && (
        <div className="pointer-events-none absolute inset-x-0 top-[6%] flex justify-center">
          <span
            className="rounded-full bg-[#040a08]/70 px-3 py-1 font-cinzel tracking-widest text-[#ffe9a8]"
            style={{ fontSize: "clamp(11px, 2.2cqh, 18px)" }}
          >
            👑 CUCERITOR
          </span>
        </div>
      )}
    </div>
  );
}
