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
//
// Fighters come in two flavours:
//   strip classes (knight, roman) ship one animated strip per beat -- n frames
//     played with CSS steps;
//   pose classes (soldier) ship one file per pose instead -- the arena stacks
//     every pose and crossfades between them, so a new pose never flashes an
//     unloaded image, and poses can carry different body language per event.

type Beat = "idle" | "attack" | "defend" | "victory";
type Pose = "idle" | "attack" | "overhead" | "hit" | "defend" | "victory" | "walk" | "dead";
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
type PoseDef = { n: number; loop?: boolean };

// sprite canvas per class. `off` nudges the box back so a class with a wider
// canvas (pose classes pad the art to a roomy 470x300 cell) still stands on the
// same spot the old strips did: half the extra box width, in arena-width %.
const SPRITE: Record<
  Cls,
  { w: number; h: number; off: number; mode: "strip" | "poses"; poses: Partial<Record<Pose, PoseDef>> }
> = {
  knight: {
    w: 270,
    h: 300,
    off: 0,
    mode: "strip",
    poses: { idle: { n: 4, loop: true }, attack: { n: 4 }, defend: { n: 3 } },
  },
  soldier: {
    w: 470,
    h: 300,
    off: -6.3,
    mode: "poses",
    poses: {
      idle: { n: 1 },
      walk: { n: 1 },
      attack: { n: 1 },
      overhead: { n: 1 },
      defend: { n: 1 },
      hit: { n: 1 },
      dead: { n: 1 },
      victory: { n: 1 },
    },
  },
  roman: {
    w: 242,
    h: 300,
    off: 0,
    mode: "strip",
    poses: { idle: { n: 4, loop: true }, attack: { n: 4 }, defend: { n: 3 } },
  },
};

// what the arena wants to show -> the poses that can play it, best first
const WANT: Record<Beat, Pose[]> = {
  idle: ["idle"],
  attack: ["attack", "overhead"],
  defend: ["hit", "defend"],
  victory: ["victory", "attack"],
};

function resolvePose(cls: Cls, beat: Beat, overhead: boolean): Pose {
  const p = SPRITE[cls].poses;
  const list: Pose[] = beat === "attack" && overhead && p.overhead ? ["overhead", "attack"] : WANT[beat];
  return list.find((x) => p[x]) ?? "idle";
}

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
const DURATION: Record<Beat, number> = { idle: 900, attack: 520, defend: 520, victory: 900 };
const HOLD_MS = 700; // how long the attack/defend pose stays before idle
const FALL_DELAY_MS = 550; // let the final hit land before the loser goes over

export default function Arena({ duel }: { duel: ArenaDuel }) {
  const [anim, setAnim] = useState<Record<Seat, Beat>>({ left: "idle", right: "idle" });
  const [fall, setFall] = useState<Record<Seat, boolean>>({ left: false, right: false });
  const [nonce, setNonce] = useState(0);
  const seen = useRef(duel.history.length);
  const status = useRef(duel.status);
  status.current = duel.status;

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
    const t = setTimeout(() => {
      // the match may have ended in this very round: keep the win pose standing
      if (status.current !== "COMPLETED") setAnim({ left: "idle", right: "idle" });
    }, HOLD_MS);
    return () => clearTimeout(t);
  }, [duel.history, duel.host.id, duel.guest, me]);

  // someone reached the edge -> the winner raises, then the loser goes over
  useEffect(() => {
    if (duel.status !== "COMPLETED" || !duel.pushedOffId) return;
    const loserIsMine = duel.pushedOffId === mine?.id;
    const t = setTimeout(() => {
      setAnim({ left: loserIsMine ? "defend" : "victory", right: loserIsMine ? "victory" : "defend" });
      setFall({ left: loserIsMine, right: !loserIsMine });
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
        const beat = anim[seat];
        // odd rounds strike overhand, even rounds thrust: the clash does not repeat
        const played = duel.host.score + (duel.guest?.score ?? 0);
        const pose = resolvePose(cls, beat, played % 2 === 1);
        const def = sp.poses[pose] ?? { n: 1 };
        // step in toward the opponent while clashing so the weapons meet;
        // `translate`% is relative to the fighter box, so convert arena-% -> box-%
        const boxWPct = HEIGHT_PCT * (1 / ARENA_AR) * (sp.w / sp.h);
        const close = beat === "attack" ? CLOSE : beat === "defend" ? CLOSE * 0.5 : 0;
        const tx = (close / boxWPct) * 100 * (seat === "left" ? 1 : -1);
        return (
          <div
            key={seat}
            className={`dw-fighter${fall[seat] ? " dw-fall" : ""}`}
            style={
              {
                left: `${f.base + sp.off + lead * STEP}%`,
                translate: `${tx}% 0`,
                height: HEIGHT,
                aspectRatio: `${sp.w} / ${sp.h}`,
                "--fx": f.fx,
                "--rot": f.rot,
              } as React.CSSProperties
            }
          >
            {sp.mode === "strip" ? (
              <div
                key={nonce}
                className={`dw-sprite ${beat === "idle" ? "dw-loop" : "dw-once"}`}
                style={
                  {
                    backgroundImage: `url(/duel/${cls}-${pose}.webp)`,
                    transform: f.mirror ? "scaleX(-1)" : undefined,
                    "--n": def.n,
                    "--sd": `${DURATION[beat]}ms`,
                  } as React.CSSProperties
                }
              />
            ) : (
              <div
                className="dw-sprite"
                style={f.mirror ? { transform: "scaleX(-1)" } : undefined}
                aria-hidden
              >
                {(Object.keys(sp.poses) as Pose[]).map((p) => (
                  <div
                    key={p}
                    className={`dw-pose${p === pose ? " dw-on" : ""}`}
                    style={{ backgroundImage: `url(/duel/${cls}-${p}.webp)` }}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
