"use client";

// The Carciuma table itself: five patrons, one plank table, smooth painted
// vectors with heavy ink outlines (Monkey Island mood, no pixels in sight).
// Everything is drawn in SVG so the table scales with the panel.

export type ScenePlayer = {
  id: string;
  seat: number;
  name: string;
  drinks: number;
  passedOut: boolean;
  mine?: boolean;
  isBot?: boolean;
  answered?: boolean;
};

type Palette = { tunic: string; tunicDark: string; skin: string; skinDark: string; hair: string; hat?: "bandana" | "tricorn" | "none"; beard?: boolean };

const PALETTES: Record<number, Palette> = {
  0: { tunic: "#3f6b5a", tunicDark: "#2b4a3e", skin: "#e0a878", skinDark: "#b98053", hair: "#33241a" },
  1: { tunic: "#7c3b3b", tunicDark: "#562525", skin: "#d29a6a", skinDark: "#a97448", hair: "#1f1a16", beard: true },
  2: { tunic: "#3b4a72", tunicDark: "#273252", skin: "#c98b5e", skinDark: "#9c6740", hair: "#4a3320", hat: "tricorn" },
  3: { tunic: "#6b5b2c", tunicDark: "#4a3f1c", skin: "#e6b98d", skinDark: "#b98a5f", hair: "#8a5a2b", hat: "none" },
  4: { tunic: "#5b3b6b", tunicDark: "#3f284a", skin: "#cf9a70", skinDark: "#a1724c", hair: "#2a211a", hat: "bandana" },
};

// head centre, scale, facing, where the drinks stand, where the name plate sits
const SEATS: Record<number, { x: number; y: number; s: number; flip: boolean; px: number; py: number; lx: number; ly: number }> = {
  0: { x: 500, y: 534, s: 1.06, flip: false, px: 668, py: 452, lx: 706, ly: 500 },
  1: { x: 168, y: 336, s: 0.94, flip: false, px: 292, py: 386, lx: 292, ly: 442 },
  2: { x: 352, y: 214, s: 0.86, flip: false, px: 386, py: 300, lx: 352, ly: 132 },
  3: { x: 648, y: 214, s: 0.86, flip: true, px: 614, py: 300, lx: 648, ly: 132 },
  4: { x: 832, y: 336, s: 0.94, flip: true, px: 708, py: 386, lx: 708, ly: 442 },
};

const INK = "#2a1608";

function Glass({ x, y, full }: { x: number; y: number; full: boolean }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <path d="M-9 0 L-7 22 L7 22 L9 0 Z" fill={full ? "#f2c46a" : "#4a3626"} opacity={full ? 0.95 : 0.55} stroke={INK} strokeWidth="2" strokeLinejoin="round" />
      {full && <path d="M-7.6 4 L-6.2 18 L6.2 18 L7.6 4 Z" fill="#ffe6a8" opacity="0.5" />}
      <rect x="-8.5" y="-2.5" width="17" height="4" rx="2" fill={full ? "#ffeec2" : "#6b5240"} stroke={INK} strokeWidth="1.6" />
      <ellipse cx="0" cy="23" rx="9" ry="2.6" fill="#000" opacity="0.25" />
    </g>
  );
}

function Bottle({ x, y, out }: { x: number; y: number; out: boolean }) {
  return (
    <g transform={`translate(${x} ${y}) ${out ? "rotate(76)" : ""}`}>
      <path d="M-6 -4 L-6 -18 L-3 -24 L-3 -34 L3 -34 L3 -24 L6 -18 L6 -4 Z" fill="#2f5a3a" stroke={INK} strokeWidth="2" strokeLinejoin="round" />
      <path d="M-4 -2 L4 -2 L4 2 L-4 2 Z" fill="#d8b064" opacity="0.8" />
      <rect x="-3.4" y="-34" width="6.8" height="4" fill="#7a5a2c" stroke={INK} strokeWidth="1.4" />
      <path d="M-4 -16 L-4 -8" stroke="#9fd8b0" strokeWidth="1.4" opacity="0.6" />
    </g>
  );
}

function Patron({ p, pal, cfg, flash, winner }: { p: ScenePlayer; pal: Palette; cfg: (typeof SEATS)[number]; flash: boolean; winner: boolean }) {
  const { x, y, s, flip } = cfg;
  const out = p.passedOut;
  const flipT = flip ? "scale(-1 1)" : "scale(1 1)";
  const tilt = out ? (flip ? 10 : -10) : 0;

  return (
    <g transform={`translate(${x} ${y}) rotate(${tilt}) scale(${s}) ${flipT}`}>
      {/* shadow on the floorboards */}
      <ellipse cx="0" cy="112" rx="62" ry="14" fill="#000" opacity="0.32" />
      {/* chair */}
      <g opacity="0.9">
        <rect x="-46" y="18" width="92" height="88" rx="10" fill="#4a2c16" stroke={INK} strokeWidth="3" />
        <rect x="-38" y="26" width="76" height="60" rx="6" fill="#633c1c" />
      </g>
      {/* torso */}
      <path d="M-44 96 C-44 46 -30 26 -24 18 L24 18 C30 26 44 46 44 96 Z" fill={pal.tunic} stroke={INK} strokeWidth="3.4" strokeLinejoin="round" />
      <path d="M-44 96 C-44 70 -38 52 -32 42 L-18 42 C-24 60 -26 78 -26 96 Z" fill={pal.tunicDark} opacity="0.55" />
      {/* collar */}
      <path d="M-16 20 L0 34 L16 20" fill="none" stroke={INK} strokeWidth="2.6" strokeLinejoin="round" />
      {/* arms on the table */}
      <path d={`M-40 74 C-64 80 -70 96 -64 104`} fill="none" stroke={INK} strokeWidth="13" strokeLinecap="round" />
      <path d={`M-40 74 C-64 80 -70 96 -64 104`} fill="none" stroke={pal.tunic} strokeWidth="9" strokeLinecap="round" />
      <path d={`M40 74 C64 80 70 96 64 104`} fill="none" stroke={INK} strokeWidth="13" strokeLinecap="round" />
      <path d={`M40 74 C64 80 70 96 64 104`} fill="none" stroke={pal.tunic} strokeWidth="9" strokeLinecap="round" />
      {/* neck + head */}
      <rect x="-9" y="0" width="18" height="16" rx="6" fill={pal.skinDark} stroke={INK} strokeWidth="2.4" />
      <ellipse cx="0" cy="-18" rx="27" ry="30" fill={pal.skin} stroke={INK} strokeWidth="3.2" />
      <ellipse cx="0" cy="-6" rx="20" ry="16" fill={pal.skinDark} opacity="0.22" />
      <ellipse cx="-27" cy="-16" rx="5.5" ry="7.5" fill={pal.skin} stroke={INK} strokeWidth="2.2" />
      <ellipse cx="27" cy="-16" rx="5.5" ry="7.5" fill={pal.skin} stroke={INK} strokeWidth="2.2" />
      {/* hair / hats */}
      {pal.hat === "tricorn" ? (
        <g>
          <path d="M-40 -30 C-26 -46 26 -46 40 -30 C48 -22 30 -14 0 -14 C-30 -14 -48 -22 -40 -30 Z" fill="#2b2622" stroke={INK} strokeWidth="3" strokeLinejoin="round" />
          <path d="M-22 -34 C-12 -46 12 -46 22 -34 Z" fill="#43392f" stroke={INK} strokeWidth="2.4" />
        </g>
      ) : pal.hat === "bandana" ? (
        <g>
          <path d="M-28 -34 C-20 -52 20 -52 28 -34 C20 -26 -20 -26 -28 -34 Z" fill="#a8352f" stroke={INK} strokeWidth="3" strokeLinejoin="round" />
          <path d="M24 -34 L36 -26 L26 -22 Z" fill="#a8352f" stroke={INK} strokeWidth="2.2" />
          <path d="M-16 -42 C-6 -48 6 -48 14 -42" fill="none" stroke="#e0b56a" strokeWidth="1.6" opacity="0.7" />
        </g>
      ) : (
        <path d="M-27 -26 C-26 -50 -10 -54 0 -54 C10 -54 26 -50 27 -26 C18 -38 -18 -38 -27 -26 Z" fill={pal.hair} stroke={INK} strokeWidth="3" strokeLinejoin="round" />
      )}
      {pal.beard && (
        <path d="M-22 -4 C-22 22 -10 30 0 30 C10 30 22 22 22 -4 C14 8 -14 8 -22 -4 Z" fill={pal.hair} stroke={INK} strokeWidth="2.6" strokeLinejoin="round" />
      )}
      {/* face */}
      {out ? (
        <g stroke={INK} strokeWidth="2.6" strokeLinecap="round">
          <path d="M-16 -24 L-6 -14 M-6 -24 L-16 -14" />
          <path d="M6 -24 L16 -14 M16 -24 L6 -14" />
          <path d="M-8 -2 C-4 4 4 4 8 -2" strokeWidth="2.2" />
        </g>
      ) : (
        <g>
          {/* brows, nose, cheeks: the difference between a face and an emoji */}
          <path d="M-17 -28 C-14 -32 -8 -31 -6 -28 M6 -28 C8 -31 14 -32 17 -28" fill="none" stroke={pal.hair} strokeWidth="2.6" strokeLinecap="round" />
          <path d="M0 -16 C-2 -11 -1 -8 2 -7" fill="none" stroke={INK} strokeWidth="2.2" strokeLinecap="round" opacity="0.75" />
          <ellipse cx="-17" cy="-6" rx="5" ry="3.4" fill="#e07a5f" opacity="0.24" />
          <ellipse cx="17" cy="-6" rx="5" ry="3.4" fill="#e07a5f" opacity="0.24" />
          <g fill={INK}>
            <ellipse cx="-11" cy="-19" rx="3.2" ry="3.6" />
            <ellipse cx="11" cy="-19" rx="3.2" ry="3.6" />
            <circle cx="-10" cy="-20.4" r="1" fill="#fff" opacity="0.85" />
            <circle cx="12" cy="-20.4" r="1" fill="#fff" opacity="0.85" />
          </g>
          <path d="M-8 -12 C-4 -8 4 -8 8 -12" fill="none" stroke={INK} strokeWidth="2.2" strokeLinecap="round" />
          {p.drinks > 0 && <circle cx="-18" cy="-8" r="4.5" fill="#d9714e" opacity="0.35" />}
          {winner && (
            <g>
              <path d="M-16 -28 L-6 -22 M16 -28 L6 -22" stroke={INK} strokeWidth="2.4" strokeLinecap="round" />
            </g>
          )}
        </g>
      )}
      {/* Zzz for the ones under the table */}
      {out && (
        <g className="cq-zzz" fill="#f4e4bf" opacity="0.9">
          <text x="34" y="-40" fontSize="18" fontFamily="var(--font-display, serif)" stroke={INK} strokeWidth="0.8">z</text>
          <text x="46" y="-58" fontSize="22" fontFamily="var(--font-display, serif)" stroke={INK} strokeWidth="0.8">z</text>
          <text x="60" y="-80" fontSize="26" fontFamily="var(--font-display, serif)" stroke={INK} strokeWidth="0.8">Z</text>
        </g>
      )}
      {flash && !out && (
        <g className="cq-splash">
          <circle cx="-6" cy="-52" r="4" fill="#f7d78a" />
          <circle cx="6" cy="-60" r="3" fill="#f7d78a" />
          <circle cx="2" cy="-46" r="2.6" fill="#ffeec2" />
        </g>
      )}
    </g>
  );
}

function NamePlate({ p, cfg }: { p: ScenePlayer; cfg: (typeof SEATS)[number] }) {
  const label = p.mine ? `${p.name} (tu)` : p.name;
  const width = Math.max(96, label.length * 9.5 + 46);
  return (
    <g transform={`translate(${cfg.lx} ${cfg.ly})`}>
      <rect x={-width / 2} y="-15" width={width} height="30" rx="7" fill="#1d1208" opacity="0.82" stroke={p.mine ? "#e8b761" : "#5b3d22"} strokeWidth={p.mine ? 2.4 : 1.6} />
      <text x={-width / 2 + 10} y="5" fontSize="14" fill={p.mine ? "#ffd98e" : "#e8d7bd"} fontFamily="var(--font-lato, sans-serif)" fontWeight="600">
        {label}
      </text>
      {[0, 1, 2].map((i) => (
        <circle key={i} cx={width / 2 - 28 + i * 9} cy="0" r="3.4" fill={i < p.drinks ? "#e2703a" : "#3a2a1c"} stroke="#6b4a2c" strokeWidth="1" />
      ))}
      {p.isBot && (
        <text x={width / 2 - 4} y="18" fontSize="9" fill="#8a6a48" textAnchor="end" fontFamily="var(--font-lato, sans-serif)">
          localnic
        </text>
      )}
    </g>
  );
}

export default function CarciumaScene({ players, flashSeat, winnerSeat }: { players: ScenePlayer[]; flashSeat: number | null; winnerSeat: number | null }) {
  const bySeat = new Map(players.map((p) => [p.seat, p]));
  const order = [2, 3, 1, 4, 0]; // far pair, then near pair, then you

  return (
    <svg viewBox="0 0 1000 620" className="w-full h-auto select-none" role="img" aria-label="Masa de la La Carciuma">
      <defs>
        <linearGradient id="cq-wall" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#5a3820" />
          <stop offset="100%" stopColor="#3a2112" />
        </linearGradient>
        <linearGradient id="cq-floor" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3a2513" />
          <stop offset="100%" stopColor="#22150a" />
        </linearGradient>
        <linearGradient id="cq-table" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#c08850" />
          <stop offset="55%" stopColor="#a06f3c" />
          <stop offset="100%" stopColor="#7c5028" />
        </linearGradient>
        <radialGradient id="cq-lantern" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%" stopColor="#ffd98a" stopOpacity="0.85" />
          <stop offset="60%" stopColor="#ffb648" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#ffb648" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="cq-window" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1b3550" />
          <stop offset="100%" stopColor="#0d1d2e" />
        </linearGradient>
        <radialGradient id="cq-vignette" cx="0.5" cy="0.45" r="0.72">
          <stop offset="55%" stopColor="#000" stopOpacity="0" />
          <stop offset="100%" stopColor="#000" stopOpacity="0.55" />
        </radialGradient>
        {/* canvas tooth: keeps the flat fills from reading like clip-art */}
        <filter id="cq-grain" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
        </filter>
      </defs>

      {/* tavern wall */}
      <rect width="1000" height="620" fill="url(#cq-wall)" />
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <rect key={i} x="0" y={i * 70} width="1000" height="3" fill="#2a170b" opacity="0.55" />
      ))}
      <rect x="0" y="0" width="1000" height="26" fill="#2a170b" />
      <rect x="0" y="0" width="1000" height="4" fill="#4b2d17" />

      {/* window with a night sky */}
      <g>
        <rect x="66" y="82" width="184" height="150" rx="10" fill="url(#cq-window)" stroke="#2a170b" strokeWidth="6" />
        <circle cx="146" cy="128" r="20" fill="#f2e3b6" opacity="0.9" />
        <circle cx="156" cy="122" r="18" fill="#0d1d2e" opacity="0.85" />
        <g fill="#dfe8ff" opacity="0.8">
          <circle cx="205" cy="112" r="1.8" />
          <circle cx="120" cy="170" r="1.6" />
          <circle cx="222" cy="186" r="2" />
        </g>
        <rect x="152" y="82" width="7" height="150" fill="#2a170b" />
        <rect x="66" y="152" width="184" height="7" fill="#2a170b" />
      </g>

      {/* shelf of bottles */}
      <g>
        <rect x="742" y="150" width="196" height="10" rx="4" fill="#5a3a1f" stroke="#2a170b" strokeWidth="3" />
        {[0, 1, 2, 3, 4].map((i) => (
          <g key={i} transform={`translate(${766 + i * 33} 150)`}>
            <rect x="-7" y={-30 - (i % 3) * 6} width="14" height={30 + (i % 3) * 6} rx="3" fill={["#2f5a3a", "#6b3a2a", "#3a4a6b"][i % 3]} stroke="#2a170b" strokeWidth="2" />
            <rect x="-3" y={-38 - (i % 3) * 6} width="6" height="9" fill="#c9a560" stroke="#2a170b" strokeWidth="1.6" />
          </g>
        ))}
      </g>

      {/* lanterns + glow */}
      <circle cx="300" cy="60" r="150" fill="url(#cq-lantern)" />
      <circle cx="700" cy="60" r="150" fill="url(#cq-lantern)" />
      {[300, 700].map((lx) => (
        <g key={lx}>
          <line x1={lx} y1="0" x2={lx} y2="60" stroke="#241207" strokeWidth="4" />
          <path d={`M${lx - 18} 60 L${lx + 18} 60 L${lx + 13} 96 L${lx - 13} 96 Z`} fill="#f0c05a" opacity="0.92" stroke="#241207" strokeWidth="3" />
          <path d={`M${lx - 13} 66 L${lx + 13} 66 L${lx + 9} 90 L${lx - 9} 90 Z`} fill="#fff0b8" />
          <rect x={lx - 20} y="55" width="40" height="6" rx="2" fill="#3a2a16" stroke="#241207" strokeWidth="2" />
        </g>
      ))}

      {/* hanging board */}
      <g>
        <line x1="420" y1="0" x2="446" y2="52" stroke="#241207" strokeWidth="3" />
        <line x1="580" y1="0" x2="554" y2="52" stroke="#241207" strokeWidth="3" />
        <rect x="404" y="50" width="192" height="56" rx="8" fill="#6d4423" stroke="#241207" strokeWidth="4" />
        <rect x="413" y="58" width="174" height="40" rx="5" fill="#8a5a30" stroke="#4a2c14" strokeWidth="2" />
        <text x="500" y="86" textAnchor="middle" fontSize="26" fill="#ffe4ac" fontFamily="var(--font-display, serif)" letterSpacing="2">
          LA CARCIUMA
        </text>
      </g>

      {/* floor + table shadow */}
      <rect y="470" width="1000" height="150" fill="url(#cq-floor)" />
      <ellipse cx="500" cy="500" rx="400" ry="90" fill="#000" opacity="0.28" />

      {/* table */}
      <g>
        <path d="M112 392 C112 320 890 320 888 392 L874 476 C860 512 140 512 126 476 Z" fill="#6b411f" stroke={INK} strokeWidth="4" />
        <ellipse cx="500" cy="366" rx="388" ry="104" fill="url(#cq-table)" stroke={INK} strokeWidth="4.5" />
        <ellipse cx="500" cy="366" rx="352" ry="86" fill="none" stroke="#7d4a22" strokeWidth="2" opacity="0.7" />
        {[0, 1, 2, 3, 4, 5].map((i) => {
          const yy = 320 + i * 17;
          return (
            <path
              key={i}
              d={`M${200 + i * 12} ${yy} C${350 + i * 10} ${yy - 14} ${640 - i * 8} ${yy + 16} ${800 - i * 10} ${yy}`}
              fill="none"
              stroke="#7d4a22"
              strokeWidth="1.8"
              opacity="0.45"
            />
          );
        })}
        <ellipse cx="500" cy="340" rx="300" ry="52" fill="#e0b57e" opacity="0.12" />
      </g>

      {/* players, far side first so the near ones overlap them */}
      {order.map((seat) => {
        const p = bySeat.get(seat);
        if (!p) return null;
        const cfg = SEATS[seat];
        return (
          <g key={p.id}>
            <Patron p={p} pal={PALETTES[seat]} cfg={cfg} flash={flashSeat === seat} winner={winnerSeat === seat} />
          </g>
        );
      })}

      {/* drinks in front of every chair */}
      {players.map((p) => {
        const cfg = SEATS[p.seat];
        return (
          <g key={`d-${p.id}`}>
            <Bottle x={cfg.px - 46} y={cfg.py - 4} out={p.passedOut} />
            {[0, 1, 2].map((i) => (
              <Glass key={i} x={cfg.px + i * 22} y={cfg.py} full={!p.passedOut && i >= p.drinks} />
            ))}
            {!p.answered && <circle cx={cfg.px + 22} cy={cfg.py - 22} r="4" fill="#e8b761" opacity="0.55" className="cq-bob" />}
          </g>
        );
      })}

      {/* name plates last: never hidden behind a shoulder */}
      {players.map((p) => (
        <NamePlate key={`n-${p.id}`} p={p} cfg={SEATS[p.seat]} />
      ))}

      <rect width="1000" height="620" filter="url(#cq-grain)" opacity="0.09" pointerEvents="none" style={{ mixBlendMode: "overlay" }} />
      <rect width="1000" height="620" fill="url(#cq-vignette)" pointerEvents="none" />
    </svg>
  );
}
