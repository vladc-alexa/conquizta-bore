'use strict';
// RULES — game rules and scoring. Rapide scoring is a direct port of lib/prc.ts.
// KEEP IN SYNC with lib/prc.ts: if the site's formula changes, change it here too.

// ---- PRC (site scoring) -------------------------------------------------
const GRILA_WINDOW = 50;
const RAPIDE_WINDOW = 50;
const RAPIDE_MAX_SCORE = 100;
const RAPIDE_MIN_SCORE = 5;
const RAPIDE_TIMER_MS = 10_000;
const CLOSENESS_WEIGHT = 0.7;
const SPEED_WEIGHT = 0.3;

/** Score for one rapide answer, 5..100 (port of rapideAnswerScore in lib/prc.ts). */
function rapideAnswerScore(guess, correct, elapsedMs) {
  const denom = Math.max(Math.abs(correct), 1);
  const relErr = Math.min(Math.abs(guess - correct) / denom, 1);
  const closeness = 1 - relErr;
  const windowMs = RAPIDE_TIMER_MS;
  const speed = Math.max(0, 1 - Math.min(Math.max(0, elapsedMs), windowMs) / windowMs);
  const score = Math.round(RAPIDE_MAX_SCORE * (CLOSENESS_WEIGHT * closeness + SPEED_WEIGHT * speed));
  return Math.max(RAPIDE_MIN_SCORE, Math.min(RAPIDE_MAX_SCORE, score));
}

/** A rapide answer counts as "correct" for game purposes when it is within 10% of the answer. */
function rapideIsClose(guess, correct, tolerance = 0.10) {
  const denom = Math.max(Math.abs(correct), 1);
  return Math.abs(guess - correct) / denom <= tolerance;
}

const isNumericText = (s) => /^-?\d+$/.test(String(s ?? '').trim());

// ---- game rules ---------------------------------------------------------
const TRAIN = {
  questions: 5,
  grilaMs: 20_000,
  rapideMs: 10_000,
};

const DUEL = {
  rounds: 7,          // max 7 rounds
  target: 4,          // first to 4 ROUND WINS (a round = one question)
  grilaMs: 15_000,
  rapideMs: 10_000,
  suddenDeathMax: 6,  // extra rapidă rounds if it is still level after round 7
};

const ROYALE = {
  grilaMs: 20_000,
  rapideMs: 10_000,
  joinWindowMs: 60_000,
  minPlayers: 2,
  escalateAfterRound: 5,
  escalateFactor: 0.75,
  minRoundMs: 6_000,
};

module.exports = {
  GRILA_WINDOW, RAPIDE_WINDOW, RAPIDE_MAX_SCORE, RAPIDE_MIN_SCORE, RAPIDE_TIMER_MS,
  CLOSENESS_WEIGHT, SPEED_WEIGHT,
  rapideAnswerScore, rapideIsClose, isNumericText,
  TRAIN, DUEL, ROYALE,
};
