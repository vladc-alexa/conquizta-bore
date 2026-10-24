"use client";

import { useEffect, useMemo, useState } from "react";

import CarciumaTable from "@/components/CarciumaTable";

export type ScenePlayer = {
  seat: number;
  name: string;
  drinks: number;
  passedOut: boolean;
  mine: boolean;
  isBot: boolean;
};

type Cfg = { left: string; bottom: string; width: string; delay: string; z: number };

// seats around the round table: two at the back (behind the felt), two at the
// sides, one in front. Everyone faces the camera, poker-room style.
const SEAT: Record<number, Cfg> = {
  // three across the back, two at the near corners: everyone behind the rim
  1: { left: "14%", bottom: "43%", width: "21%", delay: "0.4s", z: 1 },
  2: { left: "39%", bottom: "45%", width: "22%", delay: "1.2s", z: 1 },
  3: { left: "65%", bottom: "43%", width: "21%", delay: "1.8s", z: 1 },
  0: { left: "-1%", bottom: "9%", width: "26%", delay: "0.9s", z: 3 },
  4: { left: "75%", bottom: "9%", width: "26%", delay: "2.1s", z: 3 },
};

// one distinct character per seat, so the same face never shows up twice
const FACE: Record<number, string> = { 0: "doru", 1: "costel", 2: "bogdan", 3: "mirela", 4: "roxana" };

const SAY = [
  "BÂR! …pardon.",
  "Hîc!",
  "Mai pune una, bre!",
  "Sănătate!",
  "Cine mi-a luat paharul?",
  "Încă un rând și plec.",
  "Of, capul meu…",
];


// five seats, five different faces: match by name where we can, then hand out
// the leftovers so nobody at the table ever shares a face or gets the wrong sex
const SLUGS = ["costel", "bogdan", "mirela", "doru", "roxana"];
const WOMEN = new Set(["mirela", "roxana"]);
const FEMALE_NAMES = new Set(["mirela", "roxana", "lenuta", "lenua"]);
const key = (n: string) => n.toLowerCase().normalize("NFD").replace(/[^a-z]/g, "");
function assignFaces(players: ScenePlayer[]): Map<number, string> {
  const free = new Set(SLUGS);
  const out = new Map<number, string>();
  for (const p of players) {
    const k = key(p.name);
    const hit = SLUGS.find((slug) => free.has(slug) && k.includes(slug));
    if (hit) {
      out.set(p.seat, hit);
      free.delete(hit);
    }
  }
  for (const p of players) {
    if (out.has(p.seat)) continue;
    const wantWoman = FEMALE_NAMES.has(key(p.name));
    const pool = [...free].filter((s) => WOMEN.has(s) === wantWoman);
    const pick = pool[0] ?? [...free][0];
    out.set(p.seat, pick);
    free.delete(pick);
  }
  return out;
}

export default function CarciumaScene({
  players,
  flashSeat,
  winnerSeat,
}: {
  players: ScenePlayer[];
  flashSeat: number | null;
  winnerSeat: number | null;
}) {
  const faces = useMemo(() => assignFaces(players), [players]);
  const bySeat = useMemo(() => new Map(players.map((p) => [p.seat, p])), [players]);
  const awake = players.filter((p) => !p.passedOut).length;
  const [action, setAction] = useState<{ seat: number; kind: string; text: string } | null>(null);

  // tavern life: every so often somebody burps, hiccups or complains
  useEffect(() => {
    if (!awake) return;
    const timer = window.setInterval(() => {
      const seats = players.filter((p) => !p.passedOut).map((p) => p.seat);
      if (!seats.length) return;
      const seat = seats[Math.floor(Math.random() * seats.length)];
      const kinds = ["burp", "hiccup", "toast", "laugh", "wipe"];
      const kind = kinds[Math.floor(Math.random() * kinds.length)];
      setAction({ seat, kind, text: SAY[Math.floor(Math.random() * SAY.length)] });
      window.setTimeout(() => setAction(null), 2600);
    }, 7000 + Math.random() * 4000);
    return () => window.clearInterval(timer);
  }, [awake, players]);

  return (
    <div className="relative aspect-[16/10] w-full overflow-hidden rounded-2xl border-2 border-[#5b3d22] bg-[#120a04]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/carciuma/background.webp"
        alt=""
        className="absolute inset-0 h-full w-full object-cover"
        draggable={false}
      />

      {/* the back pair sits behind the table */}
      {[1, 2, 3].map((seat) => (
        <Patron key={seat} seat={seat} face={faces.get(seat) ?? "costel"} p={bySeat.get(seat)} action={action} flashSeat={flashSeat} winnerSeat={winnerSeat} />
      ))}

      {/* the poker table */}
      <div className="pointer-events-none absolute" style={{ left: "13%", bottom: "0%", width: "74%", zIndex: 2 }}>
        <CarciumaTable className="w-full" />
      </div>


      {[0, 4].map((seat) => (
        <Patron key={seat} seat={seat} face={faces.get(seat) ?? "costel"} p={bySeat.get(seat)} action={action} flashSeat={flashSeat} winnerSeat={winnerSeat} />
      ))}

      {/* name plates ride above the table so nobody's tag gets eaten by the rim */}
      {[0, 1, 2, 3, 4].map((seat) => {
        const p = bySeat.get(seat);
        return p ? <Plate key={`plate-${seat}`} p={p} at={plateAt(seat)} /> : null;
      })}
    </div>
  );
}


// name plates hang at the feet of each patron, under their sprite box
function plateAt(seat: number): { left: string; top: string } {
  const cfg = SEAT[seat];
  // clamped: on a narrow phone the edge seats would hang their plate off the scene
  const raw = parseFloat(cfg.left) + parseFloat(cfg.width) / 2;
  const left = Math.min(86, Math.max(14, raw));
  const top = Math.min(97, 100 - parseFloat(cfg.bottom) + 1.5);
  return { left: `${left}%`, top: `${top}%` };
}

function Plate({ p, at }: { p: ScenePlayer; at: { left: string; top: string } }) {
  return (
    <div
      className={`absolute -translate-x-1/2 whitespace-nowrap rounded-lg border px-2 py-0.5 text-[0.66rem] backdrop-blur-[2px] ${
        p.mine ? "border-[#e8b761] bg-[#1d1208]/85 text-[#ffd98e]" : "border-[#5b3d22] bg-[#120a04]/72 text-[#e8d7bd]"
      }`}
      style={{ left: at.left, top: at.top, zIndex: 40 }}
    >
      <span className="inline-block max-w-[7.5rem] truncate align-bottom font-semibold">{p.name}{p.mine ? " (tu)" : ""}</span>
      <span className="ml-1.5 inline-flex gap-[3px] align-middle">
        {[0, 1, 2].map((i) => (
          <i key={i} className="inline-block h-[6px] w-[6px] rounded-full border border-[#6b4a2c]"
            style={{ background: i < p.drinks ? "#e2703a" : "#2a1d12" }} />
        ))}
      </span>
    </div>
  );
}

function Patron({
  seat,
  face,
  p,
  action,
  flashSeat,
  winnerSeat,
}: {
  seat: number;
  face: string;
  p?: ScenePlayer;
  action: { seat: number; kind: string; text: string } | null;
  flashSeat: number | null;
  winnerSeat: number | null;
}) {
  if (!p) return null;
  const cfg = SEAT[seat];
  const acted = action?.seat === seat;
  const mood = p.passedOut
    ? "out"
    : acted && (action?.kind === "burp" || action?.kind === "laugh")
      ? "grin"
      : acted
        ? "drunk"
        : flashSeat === seat
          ? "drunk"
          : "idle";
  const cls = p.passedOut
    ? "cq-out"
    : winnerSeat === seat
      ? "cq-winner"
      : acted
        ? `cq-${action?.kind ?? "laugh"}`
        : "cq-idle";

  return (
    <div className="absolute" style={{ left: cfg.left, bottom: cfg.bottom, width: cfg.width, zIndex: cfg.z }}>
      <div className={cls} style={{ animationDelay: cfg.delay }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/carciuma/patron-${face}-${mood}.webp`}
          alt={p.name}
          draggable={false}
          className="w-full drop-shadow-[0_10px_18px_rgba(0,0,0,0.45)]"
        />
      </div>
      {acted && (
        <div className="cq-bubble absolute left-1/2 -translate-x-1/2" style={{ bottom: "92%" }}>
          {action?.text}
        </div>
      )}
      {p.passedOut && (
        <div className="cq-zzz absolute" style={{ left: "62%", bottom: "78%" }} aria-hidden>
          z<span>z</span><span>z</span>
        </div>
      )}
    </div>
  );
}
