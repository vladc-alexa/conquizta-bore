"use client";

import { useEffect, useRef, useState } from "react";

// The 1v1 arena: both warriors stand on the cliff plateau. Every round win
// shoves the loser toward their own edge; a net margin of `pushLimit` round
// wins sends them over the cliff and ends the match. A drawn round moves nobody.

type Anim = "idle" | "attack" | "defend";
export type ArenaWarrior = { id: string; name: string; score: number };
export type ArenaDuel = {
  status: string;
  role: "host" | "guest" | null;
  host: ArenaWarrior;
  guest: ArenaWarrior | null;
  history: { winnerId: string | null }[];
  pushLimit: number;
  pushedOffId: string | null;
};

// each player is drawn in one of these classes (stable per player id)
const CLASSES = ["knight", "soldier", "roman"] as const;
type Cls = (typeof CLASSES)[number];
// sprite cell w/h must match the exported strips (per-class, identical for all states)
const SPRITE: Record<Cls, { w: number; h: number }> = {
  knight: { w: 270, h: 300 },
  soldier: { w: 235, h: 300 },
  roman: { w: 242, h: 300 },
};
// host stands left, drawn facing right; guest is mirrored to face left
const SIDE = {
  host: { base: 28, mirror: false, fx: "-150%", rot: "-20deg" },
  guest: { base: 58, mirror: true, fx: "150%", rot: "20deg" },
} as const;

function classFor(id: string): Cls {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (Math.imul(h, 31) + id.charCodeAt(i)) >>> 0;
  return CLASSES[h % CLASSES.length];
}

const STEP = 7; // % of arena width shoved per round win
const HEIGHT = "32%"; // warrior height, relative to the arena
const FRAMES: Record<Anim, number> = { idle: 4, attack: 4, defend: 3 };
const DURATION: Record<Anim, number> = { idle: 900, attack: 520, defend: 520 };
const HOLD_MS = 700; // how long the attack/defend pose stays before idle
const FALL_DELAY_MS = 550; // let the final hit land before the loser goes over

export default function Arena({ duel }: { duel: ArenaDuel }) {
  const [anim, setAnim] = useState<Record<"host" | "guest", Anim>>({ host: "idle", guest: "idle" });
  const [fall, setFall] = useState({ host: false, guest: false });
  const [nonce, setNonce] = useState(0);
  const seen = useRef(duel.history.length);

  const push = Math.max(-duel.pushLimit, Math.min(duel.pushLimit, duel.host.score - (duel.guest?.score ?? 0)));

  // a newly resolved round -> winner jabs, loser takes the shove
  useEffect(() => {
    const hist = duel.history;
    if (hist.length <= seen.current) {
      seen.current = hist.length;
      return;
    }
    seen.current = hist.length;
    const winner = hist[hist.length - 1]?.winnerId;
    if (!winner || !duel.guest) return; // tie -> nothing happens
    const hostWon = winner === duel.host.id;
    setAnim({ host: hostWon ? "attack" : "defend", guest: hostWon ? "defend" : "attack" });
    setNonce((n) => n + 1);
    const t = setTimeout(() => setAnim({ host: "idle", guest: "idle" }), HOLD_MS);
    return () => clearTimeout(t);
  }, [duel.history, duel.host.id, duel.guest]);

  // someone reached the edge -> over they go
  useEffect(() => {
    if (duel.status !== "COMPLETED" || !duel.pushedOffId) return;
    const t = setTimeout(() => {
      setFall({ host: duel.pushedOffId === duel.host.id, guest: duel.pushedOffId === duel.guest?.id });
    }, FALL_DELAY_MS);
    return () => clearTimeout(t);
  }, [duel.status, duel.pushedOffId, duel.host.id, duel.guest?.id]);

  return (
    <div className="dw-arena" role="img" aria-label={`Arena 1 la 1: ${duel.host.name} ${duel.host.score} - ${duel.guest?.score ?? 0} ${duel.guest?.name ?? ""}`}>
      {(["host", "guest"] as const).map((side) => {
        const f = SIDE[side];
        const player = side === "host" ? duel.host : duel.guest;
        if (!player) return null;
        const cls = classFor(player.id);
        const sp = SPRITE[cls];
        const state = anim[side];
        const n = FRAMES[state];
        return (
          <div
            key={side}
            className={`dw-fighter${fall[side] ? " dw-fall" : ""}`}
            style={
              {
                left: `${f.base + push * STEP}%`,
                height: HEIGHT,
                aspectRatio: `${sp.w} / ${sp.h}`,
                "--fx": f.fx,
                "--rot": f.rot,
              } as React.CSSProperties
            }
          >
            <div
              key={nonce}
              className={`dw-sprite ${state === "idle" ? "dw-loop" : "dw-once"}`}
              style={
                {
                  backgroundImage: `url(/duel/${cls}-${state}.webp)`,
                  transform: f.mirror ? "scaleX(-1)" : undefined,
                  "--n": n,
                  "--sd": `${DURATION[state]}ms`,
                } as React.CSSProperties
              }
            />
          </div>
        );
      })}
    </div>
  );
}
