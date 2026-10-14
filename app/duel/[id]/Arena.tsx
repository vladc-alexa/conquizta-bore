"use client";

import { useEffect, useRef, useState } from "react";

// The 1v1 arena: both warriors stand on the cliff plateau. Every round win
// shoves the loser toward their own edge; a net margin of `pushLimit` round
// wins sends them over the cliff and ends the match. A drawn round moves nobody.
//
// The logged-in player is always the LEFT fighter (drawn facing right, so their
// attack reads left -> right). The opponent takes the right seat, mirrored. When
// you are the guest the whole backdrop is mirrored too, so both players see the
// same scene from their own side.

type Anim = "idle" | "attack" | "defend";
type Seat = "left" | "right";
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
// left seat = viewer (faces right as drawn); right seat = opponent (mirrored)
const SEAT = {
  left: { base: 28, mirror: false, fx: "-150%", rot: "-20deg" },
  right: { base: 58, mirror: true, fx: "150%", rot: "20deg" },
} as const;

function classFor(id: string): Cls {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (Math.imul(h, 31) + id.charCodeAt(i)) >>> 0;
  return CLASSES[h % CLASSES.length];
}

const STEP = 7; // % of arena width shoved per round win
const HEIGHT_PCT = 32; // warrior height, % of the arena height
const HEIGHT = `${HEIGHT_PCT}%`;
const ARENA_AR = 1774 / 887; // must match .dw-arena aspect-ratio
const CLOSE = 12; // arena-width % each fighter steps in during a clash (contact)
const FRAMES: Record<Anim, number> = { idle: 4, attack: 4, defend: 3 };
const DURATION: Record<Anim, number> = { idle: 900, attack: 520, defend: 520 };
const HOLD_MS = 700; // how long the attack/defend pose stays before idle
const FALL_DELAY_MS = 550; // let the final hit land before the loser goes over

export default function Arena({ duel }: { duel: ArenaDuel }) {
  const [anim, setAnim] = useState<Record<Seat, Anim>>({ left: "idle", right: "idle" });
  const [fall, setFall] = useState<Record<Seat, boolean>>({ left: false, right: false });
  const [nonce, setNonce] = useState(0);
  const seen = useRef(duel.history.length);

  // viewer owns the left seat; the other player takes the right seat
  const me = duel.role === "guest" ? "guest" : "host";
  const mirrored = me === "guest";
  const mine = me === "host" ? duel.host : duel.guest;
  const foe = me === "host" ? duel.guest : duel.host;
  const lead = (mine?.score ?? 0) - (foe?.score ?? 0);

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
    const winnerIsHost = winner === duel.host.id;
    const meWon = (me === "host") === winnerIsHost;
    setAnim({ left: meWon ? "attack" : "defend", right: meWon ? "defend" : "attack" });
    setNonce((n) => n + 1);
    const t = setTimeout(() => setAnim({ left: "idle", right: "idle" }), HOLD_MS);
    return () => clearTimeout(t);
  }, [duel.history, duel.host.id, duel.guest, me]);

  // someone reached the edge -> over they go
  useEffect(() => {
    if (duel.status !== "COMPLETED" || !duel.pushedOffId) return;
    const t = setTimeout(() => {
      setFall({ left: duel.pushedOffId === mine?.id, right: duel.pushedOffId === foe?.id });
    }, FALL_DELAY_MS);
    return () => clearTimeout(t);
  }, [duel.status, duel.pushedOffId, mine?.id, foe?.id]);

  const seats: { seat: Seat; player: ArenaWarrior | null | undefined }[] = [
    { seat: "left", player: mine },
    { seat: "right", player: foe },
  ];

  return (
    <div
      className={`dw-arena${mirrored ? " dw-mirror" : ""}`}
      role="img"
      aria-label={`Arena 1 la 1: ${duel.host.name} ${duel.host.score} - ${duel.guest?.score ?? 0} ${duel.guest?.name ?? ""}`}
    >
      <div className="dw-bg" aria-hidden />
      {seats.map(({ seat, player }) => {
        if (!player) return null;
        const f = SEAT[seat];
        const cls = classFor(player.id);
        const sp = SPRITE[cls];
        const state = anim[seat];
        const n = FRAMES[state];
        // step in toward the opponent while clashing so the weapons meet;
        // `translate`% is relative to the fighter box, so convert arena-% -> box-%
        const boxWPct = HEIGHT_PCT * (1 / ARENA_AR) * (sp.w / sp.h);
        const close = state === "attack" ? CLOSE : state === "defend" ? CLOSE * 0.5 : 0;
        const tx = (close / boxWPct) * 100 * (seat === "left" ? 1 : -1);
        return (
          <div
            key={seat}
            className={`dw-fighter${fall[seat] ? " dw-fall" : ""}`}
            style={
              {
                left: `${f.base + lead * STEP}%`,
                translate: `${tx}% 0`,
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
