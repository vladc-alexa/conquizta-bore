// Sprite slots for the 8 climbers in the tower artwork.
//
// Each seat has five painted states (see ~/.hermes skill note "Tower sprite art"):
// `calm`, `tongue`, `frown`, `yawn`, `throw`. The climbers are drawn from behind
// with the head turned back over the shoulder, so the face reads on the wall.
// `fall` is the pose used for the climber who drops off.
//
// A missing slot falls back to the gem/initial avatar, so art can land late
// without touching the game.
export type ClimberSprite = {
  calm: string;
  fall: string;
  tongue: string;
  frown: string;
  yawn: string;
  throw: string;
  /** vertical scale multiplier, in case one character reads smaller */
  scale?: number;
};

const P = "/tower/players";

function seat(n: number): ClimberSprite {
  return {
    calm: `${P}/e${n}.png`,
    fall: `${P}/e${n}_frown.png`,
    tongue: `${P}/e${n}_tongue.png`,
    frown: `${P}/e${n}_frown.png`,
    yawn: `${P}/e${n}_yawn.png`,
    throw: `${P}/e${n}_throw.png`,
  };
}

/** index = seat (0..7) */
export const CLIMBER_SPRITES: (ClimberSprite | null)[] = [
  seat(1), // knight
  seat(2), // archer
  seat(3), // dwarf
  seat(4), // mage
  seat(5), // farm boy
  seat(6), // rogue
  seat(7), // scholar
  seat(8), // mercenary
];

/** Fraction of the artwork width where each ladder sits.
 *  Measured off `tower.jpg` by detecting the two long vertical rails of every
 *  ladder in the wall band (16 rails -> 8 pairs); each value is the midpoint
 *  between the pair. Re-measure if the board artwork is ever replaced. */
export const LADDER_X = [
  0.3411, 0.3840, 0.4289, 0.4761, 0.5227, 0.5698, 0.6145, 0.6575,
];

/** Vertical band of the climb, as fractions of the artwork height, measured
 *  from the BOTTOM edge of the board (CSS `bottom`), so a climber at 0 rungs
 *  stands on the painted ladder foot and rises towards the wall top. */
export const CLIMB_GROUND = 0.09;
export const CLIMB_TOP = 0.79;
