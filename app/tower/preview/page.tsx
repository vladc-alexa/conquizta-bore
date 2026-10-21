// Dev-only art harness: renders the tower board with a fixed set of climbers so
// the sprite anchoring and the climb loop can be eyeballed (and screenshotted)
// without a database, a lobby or a live round. Not linked from the game.
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

const RUNGS = [2, 6, 11, 16, 21, 26, 30, 36];

const players: TowerStatePlayer[] = NAMES.map((name, seat) => ({
  id: `seat-${seat}`,
  name,
  seat,
  score: 40 + seat * 7,
  rungs: RUNGS[seat],
  eliminated: seat === 6,
  isBot: seat % 2 === 1,
  mine: seat === 3,
}));

export default function TowerPreview() {
  return (
    <div className="w-full max-w-5xl">
      <h1 className="mb-2 font-cinzel text-sm tracking-widest text-[#9ec6c1]">
        TURNUL · PREVIEW ARTĂ (fără DB)
      </h1>
      <Tower players={players} />
    </div>
  );
}
