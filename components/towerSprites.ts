// Sprite slots for the 8 climbers in the tower artwork.
//
// Drop the generated PNGs in `public/tower/players/` (transparent background,
// full body, feet at the bottom edge of the canvas) and fill in `src` here.
// While a slot has no `src` the climber falls back to the gem/initial avatar,
// so the game keeps working with whatever art is ready.
//
// `climb` is the pose used on the wall; `fall` (optional) is shown for the
// player who drops off after round 8.
export type ClimberSprite = {
  src: string;
  /** pose used for the eliminated player; defaults to `src` (rotated) */
  fall?: string;
  /** vertical scale multiplier, in case one character reads smaller */
  scale?: number;
};

/** index = seat (0..7) */
export const CLIMBER_SPRITES: (ClimberSprite | null)[] = [
  { src: "/tower/players/c1.png", fall: "/tower/players/f1.png" }, // knight
  { src: "/tower/players/c2.png", fall: "/tower/players/f2.png" }, // archer
  { src: "/tower/players/c3.png", fall: "/tower/players/f3.png" }, // dwarf
  { src: "/tower/players/c4.png", fall: "/tower/players/f4.png" }, // mage
  { src: "/tower/players/c5.png", fall: "/tower/players/f5.png" }, // farm boy
  { src: "/tower/players/c6.png", fall: "/tower/players/f6.png" }, // rogue
  { src: "/tower/players/c7.png", fall: "/tower/players/f7.png" }, // scholar
  { src: "/tower/players/c8.png", fall: "/tower/players/f8.png" }, // mercenary
];

/** Fraction of the artwork width where each ladder sits.
 *  Measured off `tower.jpg` by detecting the two long vertical rails of every
 *  ladder in the wall band (16 rails -> 8 pairs); each value is the midpoint
 *  between the pair. Re-measure if the board artwork is ever replaced. */
export const LADDER_X = [
  0.3411, 0.3840, 0.4289, 0.4761, 0.5227, 0.5698, 0.6145, 0.6575,
];

/** Vertical band of the climb, as fractions of the artwork height. */
export const CLIMB_TOP = 0.15;
export const CLIMB_BASE = 0.87;
