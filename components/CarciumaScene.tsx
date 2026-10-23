"use client";

// The Carciuma table: painted tavern from Gemini + five patrons cut out around
// the table. Faces swap with the game state and the locals fidget on their own.
import { useEffect, useMemo, useState } from "react";

export type ScenePlayer = {
  seat: number;
  name: string;
  drinks: number;
  passedOut: boolean;
  mine: boolean;
  isBot: boolean;
};

type Config = { left: string; bottom: string; width: string; back: boolean; slug: string; delay: string };

// seats 1..3 sit behind the table, 0 and 4 have their backs to us
const SEAT: Record<number, Config> = {
  0: { left: "34%", bottom: "-7%", width: "30%", back: true, slug: "doru", delay: "0s" },
  1: { left: "3%", bottom: "34%", width: "27%", back: false, slug: "costel", delay: "0.7s" },
  2: { left: "36.5%", bottom: "37%", width: "27%", back: false, slug: "bogdan", delay: "1.4s" },
  3: { left: "70%", bottom: "34%", width: "27%", back: false, slug: "mirela", delay: "2.1s" },
  4: { left: "61%", bottom: "-9%", width: "29%", back: true, slug: "roxana", delay: "1.1s" },
};

const ACTIONS: { kind: string; text: string[] }[] = [
  { kind: "burp", text: ["BÂR!… pardon.", "Bâââr. Sănătate!", "hopa… scuze, bre."] },
  { kind: "toast", text: ["Noroc!", "Cin-cin, măi!", "La sănătatea mesei!"] },
  { kind: "hiccup", text: ["Hîc!", "Hîc… hîc!", "Of, capul meu."] },
  { kind: "laugh", text: ["Ha! Bună asta.", "Mai spune o dată!", "Hahahaha!"] },
  { kind: "wipe", text: ["Mai pune una, Mario!", "Unde mi-e paharul?", "Cine mi-a băut berea?"] },
];

// plate anchors as % of the card: on the table for the far seats, above the
// heads for the two seen from behind
const PLATES = [
  { seat: 1, left: "15%", top: "66%" },
  { seat: 2, left: "50%", top: "62%" },
  { seat: 3, left: "85%", top: "66%" },
  { seat: 0, left: "44%", top: "93%" },
  { seat: 4, left: "63%", top: "93%" },
];

// bots keep their identity: if the name matches a face we have, use that face
const FACE: Record<string, string> = {
  "nea costel": "costel",
  costel: "costel",
  bogdan: "bogdan",
  mirela: "mirela",
  lenuta: "mirela",
  "lenuța": "mirela",
  roxana: "mirela",
  doru: "bogdan",
};
function faceFor(p: { name: string; seat: number }, cfg: Config): string {
  const key = p.name.trim().toLowerCase();
  const face = FACE[key];
  if (!face) return cfg.slug;
  return cfg.back ? "doru" : face;
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
  const bySeat = useMemo(() => new Map(players.map((p) => [p.seat, p])), [players]);
  const awake = players.filter((p) => !p.passedOut).map((p) => p.seat).join(",");
  const [action, setAction] = useState<{ seat: number; kind: string; text: string } | null>(null);

  // the locals fidget on their own: one small business every ~6-10s
  useEffect(() => {
    const seats = awake ? awake.split(",").map(Number) : [];
    if (!seats.length) return;
    let hide: ReturnType<typeof setTimeout>;
    const tick = () => {
      const seat = seats[Math.floor(Math.random() * seats.length)];
      const pool = ACTIONS[Math.floor(Math.random() * ACTIONS.length)];
      const text = pool.text[Math.floor(Math.random() * pool.text.length)];
      setAction({ seat, kind: pool.kind, text });
      hide = setTimeout(() => setAction(null), 2600);
    };
    const id = setInterval(tick, 6500 + Math.random() * 3500);
    return () => {
      clearInterval(id);
      clearTimeout(hide);
    };
  }, [awake]);

  return (
    <div className="relative aspect-[16/10] w-full overflow-hidden rounded-2xl border-2 border-[#5a3a1e] bg-[#160d05]">
      <img
        src="/carciuma/background.webp"
        alt=""
        className="absolute inset-0 h-full w-full object-cover"
        draggable={false}
      />
      <div className="absolute inset-0 bg-gradient-to-t from-[#0b0603]/70 via-transparent to-[#0b0603]/25" />

      {[0, 1, 2, 3, 4].map((seat) => {
        const p = bySeat.get(seat);
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
        const src = cfg.back
          ? `/carciuma/patron-${cfg.slug}-back.webp`
          : `/carciuma/patron-${faceFor(p, cfg)}-${mood}.webp`;
        return (
          <div
            key={seat}
            className={`absolute select-none ${p.passedOut ? "cq-out" : "cq-idle"} ${acted ? `cq-${action?.kind}` : ""} ${
              seat === winnerSeat ? "cq-winner" : ""
            }`}
            style={{ left: cfg.left, bottom: cfg.bottom, width: cfg.width, animationDelay: cfg.delay }}
          >
            <img
              src={src}
              alt={p.name}
              draggable={false}
              className="w-full drop-shadow-[0_12px_20px_rgba(0,0,0,0.45)]"
            />
            {acted && (
              <div className="cq-bubble" style={{ left: "50%", bottom: "82%" }}>
                {action?.kind === "burp" ? "💨 " : action?.kind === "toast" ? "🍻 " : ""}
                {action?.text}
              </div>
            )}
            {p.passedOut && (
              <div className="cq-zzz" aria-hidden>
                z<span>z</span><span>z</span>
              </div>
            )}
          </div>
        );
      })}
      {/* name plates + drink pips, pinned to the table so no face gets covered */}
      {PLATES.map(({ seat, left, top }) => {
        const p = bySeat.get(seat);
        if (!p) return null;
        return (
          <div
            key={`plate-${seat}`}
            className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-lg border px-2 py-0.5 text-[0.66rem] backdrop-blur-[2px] ${
              p.mine
                ? "border-[#e8b761] bg-[#1d1208]/90 text-[#ffd98e]"
                : "border-[#5b3d22] bg-[#120a04]/80 text-[#e8d7bd]"
            }`}
            style={{ left, top }}
          >
            <span className="whitespace-nowrap font-semibold">{p.mine ? `${p.name} (tu)` : p.name}</span>
            <span className="ml-1.5 inline-flex gap-[3px] align-middle">
              {[0, 1, 2].map((i) => (
                <i
                  key={i}
                  className="inline-block h-[6px] w-[6px] rounded-full border border-[#6b4a2c]"
                  style={{ background: i < p.drinks ? "#e2703a" : "#2a1d12" }}
                />
              ))}
            </span>
          </div>
        );
      })}
    </div>
  );
}
