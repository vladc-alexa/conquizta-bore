'use strict';
// Local harness — plays the three modes against the REAL question database with
// scripted players on a virtual clock, so the rules are provable without Discord.
//
//   node --env-file=../.env src/harness.js                 # dry-run (writes nothing)
//   node --env-file=../.env src/harness.js --store=rollback # writes a real session, rolls it back
//
// Nothing here talks to Discord. The Discord transport (discord-transport.js) only
// renders the events this harness prints.

const { PrismaClient } = require('@prisma/client');
const { pullMixed, pullRapide } = require('./questions');
const { Store } = require('./store');
const { TrainRun, Duel, Royale } = require('./engine');
const R = require('./rules');

// ------------------------------------------------------------- utilities ---
class VirtualClock {
  constructor() { this.t = 0; this.q = []; this.seq = 0; }
  now() { return this.t; }
  schedule(ms, fn) {
    const h = { at: this.t + Math.max(0, ms), fn, seq: this.seq++, cancelled: false, done: false };
    this.q.push(h);
    return h;
  }
  cancel(h) { if (h) h.cancelled = true; }
  async run(limit = 50000) {
    for (let steps = 0; steps < limit; steps++) {
      const pend = this.q.filter((h) => !h.cancelled && !h.done);
      if (!pend.length) return;
      pend.sort((a, b) => a.at - b.at || a.seq - b.seq);
      const next = pend[0];
      next.done = true;
      this.t = Math.max(this.t, next.at);
      await next.fn();
    }
    throw new Error('virtual clock runaway');
  }
}

const OUT = [];
const say = (line = '') => { OUT.push(line); console.log(line); };
function stamp(ms) {
  const s = ms / 1000;
  return `[${String(Math.floor(s / 60)).padStart(2, '0')}:${(s % 60).toFixed(1).padStart(4, '0')}]`;
}

const problems = [];
function check(cond, label) {
  if (!cond) problems.push(label);
  return cond;
}

// --------------------------------------------------------------- players ---
const PROFILES = {
  ana:    { accuracy: 0.85, answerProb: 0.97, minMs: 900,  maxMs: 4500, skipRounds: [] },
  bogdan: { accuracy: 0.60, answerProb: 0.92, minMs: 1400, maxMs: 6200, skipRounds: [] },
  cara:   { accuracy: 0.35, answerProb: 0.80, minMs: 2200, maxMs: 9500, skipRounds: [] },
  dan:    { accuracy: 0.50, answerProb: 0.90, minMs: 1800, maxMs: 7000, skipRounds: [] },
};
const mkPlayers = (...names) => names.map((n) => ({ id: n, name: n, userId: null, profile: PROFILES[n] }));

// seeded RNG so a run is reproducible (--seed=N)
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let rnd = mulberry32(42);

function correctPayload(q) {
  return q.mode === 'grila' ? { index: q.correctIndex } : { value: q.correctNumber };
}
function wrongPayload(q) {
  if (q.mode === 'grila') return { index: (q.correctIndex + 1 + Math.floor(rnd() * 3)) % 4 };
  return { value: q.correctNumber === 0 ? 7 : Math.round(q.correctNumber * (rnd() < 0.5 ? 0.45 : 1.9)) || 13 };
}
function guessNear(q) {
  const jitter = 1 + (rnd() - 0.5) * 0.06; // inside the 10% tolerance
  return Math.round(q.correctNumber * jitter);
}

/**
 * Schedule a scripted answer for each active player when a question opens.
 * The question object AND its round token are captured here, so a late callback
 * can never be graded against the next question — exactly what a Discord button
 * must also carry (customId = token).
 */
function scriptAnswers({ clock, game, players, q, token, round, dupTest, staleTest }) {
  for (const p of players) {
    const prof = p.profile;
    if (!game.activeIds().includes(p.id)) continue;
    if (prof.skipRounds.includes(round)) continue;          // deliberate timeout
    if (rnd() > prof.answerProb) continue;                  // AFK
    const wantCorrect = rnd() < prof.accuracy;
    const lat = prof.minMs + rnd() * (prof.maxMs - prof.minMs);
    clock.schedule(lat, async () => {
      const payload = wantCorrect ? (q.mode === 'rapide' ? { value: guessNear(q) } : correctPayload(q)) : wrongPayload(q);
      const res = await game.answer(p.id, payload, token);
      if (!res.ok) say(`${stamp(clock.now())}   R${String(round).padStart(2)} ${p.name.padEnd(6)} → refuzat: ${res.error}`);
      if (res.ok && dupTest && !dupTest.done) {             // duplicate-submission guard
        dupTest.done = true;
        const again = await game.answer(p.id, payload, token);
        check(again.ok === false, 'duplicate answer was accepted');
        say(`${stamp(clock.now())}   R${String(round).padStart(2)} ${p.name.padEnd(6)} → re-trimis  ${again.ok ? 'ACCEPTAT (bug!)' : 'refuzat ✔'}`);
      }
      if (staleTest && !staleTest.done) {
        staleTest.done = true;
        const stale = await game.answer(p.id, payload, `${game.id}:999`); // click from a closed round
        check(stale.ok === false, 'stale-round answer was accepted');
        say(`${stamp(clock.now())}   R${String(round).padStart(2)} ${p.name.padEnd(6)} → click vechi (token închis)  ${stale.ok ? 'ACCEPTAT (bug!)' : 'refuzat ✔'}`);
      }
    });
  }
}

function renderQuestion(game, ev, clock, seesPublic) {
  const pub = ev.public;
  seesPublic.push(pub);
  const head = pub.mode === 'grila'
    ? pub.options.map((o) => `${o.label}) ${o.text}`).join('   ')
    : `(răspuns numeric, ${(ev.timeoutMs / 1000).toFixed(0)}s)`;
  say(`${stamp(clock.now())} R${String(ev.round).padStart(2)} ${pub.mode.padEnd(6)} ${ev.timeoutMs / 1000}s  „${pub.prompt}"`);
  say(`${' '.repeat(10)}${head}`);
}

function renderReveal(game, ev, clock) {
  const flag = ev.voided ? '  (rundă anulată — niciun supraviețuitor)' : '';
  say(`${stamp(clock.now())} → corect: ${ev.correctLabel}${flag}`);
  if (ev.eliminated && ev.eliminated.length) say(`${' '.repeat(10)}OUT: ${ev.eliminated.join(', ')}  |  în joc: ${ev.alive.join(', ')}`);
  if (ev.results && ev.results.some((r) => r.won !== undefined)) {
    const won = ev.results.filter((r) => r.won).map((r) => game.nameOf(r.playerId));
    say(`${' '.repeat(10)}runda: ${won.length ? won.join(', ') + ' ✔' : 'egală'}`);
  }
  if (ev.note) say(`${' '.repeat(10)}${ev.note}`);
}

async function runGame({ title, game, clock, players, seesPublic, dupTest, staleTest, board, rapideScores }) {
  say('');
  say(`── ${title} ${'─'.repeat(Math.max(0, 60 - title.length))}`);
  const onEvent = async (g, ev, data) => {
    switch (ev) {
      case 'gameStart': say(`${stamp(clock.now())} start: ${JSON.stringify(data)}`); break;
      case 'question': {
        const q = g.current;
        const token = data.token;
        renderQuestion(g, data, clock, seesPublic);
        scriptAnswers({ clock, game: g, players, q, token, round: data.round, dupTest, staleTest });
        break;
      }
      case 'accepted': {
        const graded = data.graded;
        const nm = (players.find((p) => p.id === data.playerId) || {}).name || data.playerId;
        const shown = String(graded.raw ?? '').padEnd(5);
        const pts = graded.mode === 'rapide' ? ` (${graded.score} pct)` : '';
        say(`${stamp(clock.now())}   R${String(data.round).padStart(2)} ${nm.padEnd(6)} → ${shown} ${graded.isCorrect ? '✔ corect' : '✘ greșit'}${pts}`);
        if (graded.mode === 'rapide') rapideScores.push(graded.score);
        break;
      }
      case 'reveal': renderReveal(g, data, clock); break;
      case 'gameEnd':
        say(`${stamp(clock.now())} FINAL: ${JSON.stringify({ winner: data.winner, out: data.out, score: data.score, correct: data.correct, total: data.total, rounds: data.rounds })}`);
        board.push(data);
        break;
      default: break;
    }
  };
  game.onEvent = onEvent;
  await game.start();
  await clock.run();
  return game;
}

// ------------------------------------------------------------------ main ---
(async () => {
  const prisma = new PrismaClient();
  const storeMode = (process.argv.find((a) => a.startsWith('--store=')) || '--store=dry').split('=')[1];
  const store = new Store({ prisma, mode: storeMode, log: say });
  let rollbackUser = null;
  if (storeMode !== 'dry') {
    rollbackUser = await prisma.user.findFirst({ select: { id: true, displayName: true }, orderBy: { createdAt: 'asc' } });
  }
  const clock = new VirtualClock();
  const seesPublic = [];
  const board = [];
  const rapideScores = [];
  rnd = mulberry32(Number((process.argv.find((a) => a.startsWith('--seed=')) || '--seed=42').split('=')[1]) || 42);

  const [royaleQs, duelQs, duelExtra, trainQs] = await Promise.all([
    pullMixed(prisma, 24, 0.6),
    pullMixed(prisma, 9, 0.55),
    pullRapide(prisma, 6),
    pullMixed(prisma, 10, 0.6),
  ]);
  say(`întrebări reale din DB: royale ${royaleQs.length}, duel ${duelQs.length} (+${duelExtra.length} rapide), antrenament ${trainQs.length}`);
  check(royaleQs.length >= 8 && duelQs.length >= 7 && trainQs.length === 10, 'not enough published questions pulled');

  // ---- 1) battle royale, 4 players
  const royalePlayers = mkPlayers('ana', 'bogdan', 'cara', 'dan');
  royalePlayers.find((p) => p.name === 'cara').profile = { ...PROFILES.cara, skipRounds: [2, 4] };
  await runGame({
    title: '#antrenament · /royale (4 jucători, eliminare)', clock, players: royalePlayers, board,
    seesPublic, dupTest: { done: false }, staleTest: { done: false }, rapideScores,
    game: new Royale({ id: 'royale-1', players: royalePlayers, questions: royaleQs, clock, store }),
  });

  // ---- 2) 1v1 duel
  const duelPlayers = mkPlayers('ana', 'bogdan');
  await runGame({
    title: '#1vs1 · /duel (best of 7, primul la 4)', clock, players: duelPlayers, board,
    seesPublic, dupTest: null, staleTest: null, rapideScores,
    game: new Duel({ id: 'duel-1', players: duelPlayers, questions: duelQs, extraRapide: duelExtra, clock, store }),
  });

  // ---- 3) antrenament solo
  const solo = mkPlayers('dan');
  if (rollbackUser) {
    solo[0].userId = rollbackUser.id;
    say(`(store=${store.mode}) sesiunea solo se scrie pentru userul real „${rollbackUser.displayName}" <${rollbackUser.id.slice(0, 8)}> — apoi rollback`);
  }
  await runGame({
    title: '#antrenament · /antrenament (10 întrebări, fără eliminare)', clock, players: solo, board,
    seesPublic, dupTest: null, staleTest: null, rapideScores,
    game: new TrainRun({ id: 'train-1', player: solo[0], questions: trainQs, clock, store }),
  });

  // ------------------------------------------------------------ invariants ---
  say('');
  say('── verificări ' + '─'.repeat(48));
  const royale = board.find((b) => b.mode === 'royale');
  const duel = board.find((b) => b.mode === 'duel');
  const train = board.find((b) => b.mode === 'train');

  check(!!royale && royale.out.length === 3, 'royale: expected exactly 3 eliminations out of 4 players');
  check(!!royale && !!royale.winner, 'royale: no winner');
  check(!!duel && (duel.winner || duel.draw), 'duel: no result');
  check(!!duel && (duel.wins >= R.DUEL.target || duel.rounds >= R.DUEL.rounds), 'duel: ended without 4 round wins or 7 rounds');
  check(!!duel && duel.rounds <= R.DUEL.rounds + R.DUEL.suddenDeathMax, 'duel: ran past the sudden-death cap');
  check(!!train && train.total === R.TRAIN.questions, `train: expected ${R.TRAIN.questions} questions, got ${train && train.total}`);

  const uuids = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/;
  const leaks = seesPublic.filter((p) => uuids.test(JSON.stringify(p)));
  check(leaks.length === 0, `question payload leaked ids (${leaks.length})`);
  const rapideLeak = seesPublic.filter((p) => p.mode === 'rapide' && /\d/.test(JSON.stringify(p.options)));
  check(rapideLeak.length === 0, 'rapide payload carried options');

  check(rapideScores.length > 0, 'no rapide answers were graded');
  const outOfRange = rapideScores.filter((s) => s < R.RAPIDE_MIN || s > R.RAPIDE_MAX);
  check(outOfRange.length === 0, `rapide scores out of range [${R.RAPIDE_MIN},${R.RAPIDE_MAX}]: ${outOfRange.join(',')}`);

  say(`${problems.length ? '✘' : '✔'} ${problems.length ? `probleme: ${problems.join(' | ')}` : 'toate verificările au trecut'}`);
  say(`întrebări publice emise: ${seesPublic.length} (niciun id scurs: ${leaks.length === 0 ? 'confirmat' : 'NU'})`);

  // ------------------------------------------------------------- dry report ---
  say('');
  say(`── ce s-ar scrie în DB (store=${storeMode}) ` + '─'.repeat(20));
  const rep = store.report();
  say(`sesiuni: ${rep.length}`);
  for (const r of rep) say(`  ${r.mode.padEnd(7)} user=${r.userId ?? 'null'} ${r.correctCount}/${r.questionCount} corecte, ${r.answers.length} răspunsuri`);
  const sample = rep[0] && rep[0].answers.slice(0, 3);
  if (sample) { say('  exemplu primele 3 răspunsuri ale sesiunii 1:'); for (const a of sample) say(`    ${JSON.stringify(a)}`); }

  say('');
  say(problems.length ? 'REZULTAT: probleme găsite' : 'REZULTAT: motorul funcționează conform regulilor');
  await prisma.$disconnect();
  process.exit(problems.length ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(2); });
