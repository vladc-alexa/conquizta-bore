'use strict';
// Game engine — deterministic, transport-agnostic, LLM-free.
//
// Modes:
//   TrainRun : 5 questions, no elimination, one player, PRC-counted
//   Duel     : 2 players, best of 7 (first to 4), alternates grila/rapide
//   Royale   : N players, same question to everyone, wrong or too slow = OUT, last standing wins
//
// The engine owns the correct answers; transports only ever receive public
// question payloads (option indices + labels), never ids and never the key.

const R = require('./rules');
const { publicQuestion } = require('./questions');

const LABELS = 'ABCD';

class BaseGame {
  constructor({ id, mode, players, questions, clock, store, onEvent, wallBase }) {
    this.id = id;
    this.mode = mode;
    this.players = players.map((p) => ({ id: p.id, name: p.name }));
    this.questions = questions;
    this.clock = clock;
    this.store = store;
    this.onEvent = onEvent || (() => {});
    this.wallBase = wallBase ?? Date.now();
    this.qi = -1;
    this.round = 0;
    this.startedAt = null;
    this.over = false;
    this.timer = null;
    this.records = new Map(
      this.players.map((p) => [p.id, { player: p, answers: [], points: 0, roundWins: 0, out: false }])
    );
  }

  emit(ev, data) {
    return this.onEvent(this, ev, data);
  }
  nameOf(id) {
    return this.records.get(id)?.player.name ?? id;
  }
  activeIds() {
    return this.players.filter((p) => !this.records.get(p.id).out).map((p) => p.id);
  }
  nextQuestion() {
    this.qi++;
    if (this.qi < this.questions.length) return this.questions[this.qi];
    // wrap around (long games) — avoid repeating within the same round window
    return this.questions[this.qi % this.questions.length];
  }
  grade(q, payload, elapsedMs) {
    if (q.mode === 'grila') {
      const idx = Number(payload && payload.index);
      const ok = Number.isInteger(idx) && idx === q.correctIndex;
      const chosen = Number.isInteger(idx) && q.options[idx] ? q.options[idx] : null;
      return {
        mode: 'grila',
        answered: chosen != null,
        selectedOptionId: chosen ? chosen.id : null,
        submittedAnswer: null,
        raw: chosen ? LABELS[idx] : null,
        isCorrect: ok,
        score: ok ? 100 : 0,
        elapsedMs,
      };
    }
    const guess = payload && payload.value != null ? Number(payload.value) : NaN;
    if (!Number.isFinite(guess)) {
      return { mode: 'rapide', answered: false, selectedOptionId: null, submittedAnswer: null, raw: null, isCorrect: false, score: 0, elapsedMs };
    }
    const score = R.rapideAnswerScore(guess, q.correctNumber, elapsedMs);
    return {
      mode: 'rapide',
      answered: true,
      selectedOptionId: null,
      submittedAnswer: String(Math.trunc(guess)),
      raw: String(Math.trunc(guess)),
      isCorrect: R.rapideIsClose(guess, q.correctNumber),
      score,
      elapsedMs,
    };
  }
  correctLabel(q) {
    return q.mode === 'grila' ? `${LABELS[q.correctIndex]}) ${q.options[q.correctIndex].text}` : String(q.correctNumber);
  }
  /** Open one question round. onExpire fires when the timer runs out. */
  async openRound(q, timeoutMs, extra = {}) {
    this.round++;
    this.current = q;
    this.answers = new Map();
    this.roundMs = timeoutMs;
    this.roundStart = this.clock.now();
    this.roundToken = (this.roundToken || 0) + 1;
    this.currentToken = `${this.id}:${this.roundToken}`;
    await this.emit('question', {
      round: this.round,
      timeoutMs,
      token: this.currentToken,
      public: publicQuestion(q),
      active: this.activeIds(),
      ...extra,
    });
    this.timer = this.clock.schedule(timeoutMs, () => this.closeRound('timeout'));
  }
  /** Record a player's answer. Returns {ok:false,error} when the submission is refused. */
  async answer(playerId, payload, token) {
    if (this.over) return { ok: false, error: 'joc încheiat' };
    if (!this.current) return { ok: false, error: 'nicio întrebare deschisă' };
    if (token != null && token !== this.currentToken) return { ok: false, error: 'întrebarea s-a închis' };
    if (!this.activeIds().includes(playerId)) return { ok: false, error: 'nu ești în runda curentă' };
    if (this.answers.has(playerId)) return { ok: false, error: 'ai răspuns deja' };
    const elapsed = this.clock.now() - this.roundStart;
    const graded = this.grade(this.current, payload, elapsed);
    if (!graded.answered) return { ok: false, error: 'răspuns invalid' };
    graded.answeredAt = this.wallBase + this.clock.now();
    this.answers.set(playerId, graded);
    await this.emit('accepted', { playerId, graded, round: this.round, token: this.currentToken });
    if (this.answers.size >= this.activeIds().length) {
      if (this.timer) this.clock.cancel(this.timer);
      this.timer = null;
      await this.closeRound('complete');
    }
    return { ok: true, correct: graded.isCorrect, score: graded.score };
  }
  _storeAnswer(playerId, graded) {
    this.records.get(playerId).answers.push({
      questionId: this.current.id,
      selectedOptionId: graded.selectedOptionId,
      submittedAnswer: graded.submittedAnswer,
      isCorrect: graded.isCorrect,
      elapsedMilliseconds: Math.round(graded.elapsedMs),
      answeredAt: graded.answeredAt,
    });
  }
  async persistAll() {
    const out = [];
    for (const rec of this.records.values()) {
      if (!rec.answers.length) continue;
      out.push(
        await this.store.finalizeGame({
          playerId: rec.player.userId ?? null,
          mode: this.mode,
          startedAt: this.wallBase + (this.startedAt ?? 0),
          completedAt: this.wallBase + this.clock.now(),
          answers: rec.answers,
        })
      );
    }
    return out;
  }
}

// ---------------------------------------------------------------- TRAIN ---
class TrainRun extends BaseGame {
  constructor(opts) {
    super({ ...opts, mode: 'train', players: [opts.player] });
    this.questionCount = R.TRAIN.questions;
    this.correct = 0;
    this.rapideSum = 0;
    this.rapideN = 0;
  }
  async start() {
    this.startedAt = this.clock.now();
    await this.emit('gameStart', { mode: 'train', total: this.questionCount });
    await this._next(0);
  }
  async _next(i) {
    if (i >= this.questionCount || this.over) return this.finish();
    const q = this.questions[i % this.questions.length];
    this.currentIndex = i;
    await this.openRound(q, q.mode === 'grila' ? R.TRAIN.grilaMs : R.TRAIN.rapideMs, { index: i + 1, total: this.questionCount });
  }
  async closeRound(reason) {
    this.timer = null;
    this.currentToken = null; // any click arriving from here on belongs to a closed round
    const q = this.current;
    const pid = this.players[0].id;
    const graded = this.answers.get(pid) || {
      mode: q.mode, answered: false, selectedOptionId: null, submittedAnswer: null,
      raw: null, isCorrect: false, score: 0, elapsedMs: this.roundMs, answeredAt: this.wallBase + this.clock.now(),
    };
    this._storeAnswer(pid, graded);
    if (graded.isCorrect) this.correct++;
    if (q.mode === 'rapide') { this.rapideSum += graded.score; this.rapideN++; }
    await this.emit('reveal', {
      round: this.round,
      reason,
      correctLabel: this.correctLabel(q),
      results: [{ playerId: pid, graded, out: false }],
      note: `${this.correct}/${this.currentIndex + 1} corecte`,
    });
    await this._next(this.currentIndex + 1);
  }
  async finish() {
    if (this.over) return;
    this.over = true;
    const summary = {
      mode: 'train',
      player: this.players[0].name,
      correct: this.correct,
      total: this.round,
      rapideMean: this.rapideN ? Math.round(this.rapideSum / this.rapideN) : null,
    };
    const persisted = await this.persistAll();
    await this.emit('gameEnd', { ...summary, persisted });
  }
}

// ----------------------------------------------------------------- DUEL ---
class Duel extends BaseGame {
  constructor(opts) {
    super({ ...opts, mode: 'duel' });
    this.extraRapide = opts.extraRapide || [];
    this.roundLog = [];
  }
  async start() {
    this.startedAt = this.clock.now();
    await this.emit('gameStart', { mode: 'duel', players: this.players.map((p) => p.name), target: R.DUEL.target, maxRounds: R.DUEL.rounds });
    await this._next();
  }
  _wins() {
    return this.players.map((p) => this.records.get(p.id).roundWins);
  }
  _finished() {
    const [a, b] = this._wins();
    if (a >= R.DUEL.target || b >= R.DUEL.target) return true;
    if (this.round >= R.DUEL.rounds && a !== b) return true;
    if (this.round >= R.DUEL.rounds + R.DUEL.suddenDeathMax) return true; // safety valve
    return false;
  }
  async _next() {
    if (this.over) return;
    if (this._finished()) return this.finish();
    let q;
    if (this.round < R.DUEL.rounds) {
      q = this.questions[this.round % this.questions.length];
    } else {
      // sudden death: extra rapide questions
      const pool = this.extraRapide.length ? this.extraRapide : this.questions.filter((x) => x.mode === 'rapide');
      q = pool[(this.round - R.DUEL.rounds) % pool.length];
    }
    await this.openRound(q, q.mode === 'grila' ? R.DUEL.grilaMs : R.DUEL.rapideMs);
  }
  async closeRound(reason) {
    this.timer = null;
    this.currentToken = null;
    const q = this.current;
    const results = [];
    for (const p of this.players) {
      const rec = this.records.get(p.id);
      const graded = this.answers.get(p.id) || {
        mode: q.mode, answered: false, selectedOptionId: null, submittedAnswer: null,
        raw: null, isCorrect: false, score: 0, elapsedMs: this.roundMs, answeredAt: this.wallBase + this.clock.now(),
      };
      this._storeAnswer(p.id, graded);
      results.push({ playerId: p.id, graded, out: false });
    }
    // Who takes the round?  grila: the correct answer that came first.
    //                       rapide: the higher PRC score (needs a real answer).
    let winnerId = null;
    if (q.mode === 'grila') {
      const correct = results.filter((r) => r.graded.isCorrect).sort((a, b) => a.graded.elapsedMs - b.graded.elapsedMs);
      winnerId = correct.length ? correct[0].playerId : null;
    } else {
      const ranked = results
        .filter((r) => r.graded.answered)
        .sort((a, b) => b.graded.score - a.graded.score || a.graded.elapsedMs - b.graded.elapsedMs);
      if (ranked.length === 2) {
        const [first, second] = ranked;
        // equal PRC score -> the faster answer takes the round
        if (first.graded.score > second.graded.score || first.graded.elapsedMs < second.graded.elapsedMs) winnerId = first.playerId;
      } else if (ranked.length === 1 && ranked[0].graded.score > 0) winnerId = ranked[0].playerId;
    }
    if (winnerId) this.records.get(winnerId).roundWins += 1;
    this.roundLog.push({ round: this.round, mode: q.mode, winner: winnerId ? this.nameOf(winnerId) : null });
    await this.emit('reveal', {
      round: this.round,
      reason,
      correctLabel: this.correctLabel(q),
      results: results.map((r) => ({ ...r, won: r.playerId === winnerId, total: this.records.get(r.playerId).roundWins })),
      note: `${this.scoreLine()}${winnerId ? '' : '  (rundă egală)'}`,
    });
    await this._next();
  }
  scoreLine() {
    return this.players.map((p) => `${p.name} ${this.records.get(p.id).roundWins}`).join(' — ');
  }
  async finish() {
    if (this.over) return;
    this.over = true;
    const ranked = this.players
      .map((p) => ({ player: p, wins: this.records.get(p.id).roundWins }))
      .sort((a, b) => b.wins - a.wins);
    const winner = ranked[0].wins === ranked[1].wins ? null : ranked[0].player;
    const persisted = await this.persistAll();
    await this.emit('gameEnd', {
      mode: 'duel',
      winner: winner ? winner.name : null,
      draw: !winner,
      wins: ranked[0].wins,
      score: ranked.map((r) => `${r.player.name} ${r.wins}`).join(' — '),
      rounds: this.round,
      persisted,
    });
  }
}

// --------------------------------------------------------------- ROYALE ---
class Royale extends BaseGame {
  constructor(opts) {
    super({ ...opts, mode: 'royale' });
    this.eliminatedOrder = [];
  }
  async start() {
    this.startedAt = this.clock.now();
    await this.emit('gameStart', { mode: 'royale', players: this.players.map((p) => p.name) });
    await this._next();
  }
  _next() {
    if (this.over) return;
    if (this.activeIds().length <= 1) return this.finish();
    const q = this.nextQuestion();
    const base = q.mode === 'grila' ? R.ROYALE.grilaMs : R.ROYALE.rapideMs;
    const escalate = this.round >= R.ROYALE.escalateAfterRound;
    const ms = escalate ? Math.max(R.ROYALE.minRoundMs, Math.round(base * R.ROYALE.escalateFactor)) : base;
    const prev = this.timer;
    this.timer = null;
    if (prev) this.clock.cancel(prev);
    return this.openRound(q, ms, { escalate, alive: this.activeIds().length });
  }
  async closeRound(reason) {
    this.timer = null;
    this.currentToken = null;
    const q = this.current;
    const active = this.activeIds();
    const results = [];
    const losers = [];
    for (const pid of active) {
      const graded = this.answers.get(pid) || {
        mode: q.mode, answered: false, selectedOptionId: null, submittedAnswer: null,
        raw: null, isCorrect: false, score: 0, elapsedMs: this.roundMs, answeredAt: this.wallBase + this.clock.now(),
      };
      this._storeAnswer(pid, graded);
      const out = !graded.isCorrect;
      results.push({ playerId: pid, graded, out });
      if (out) losers.push(pid);
    }
    const voided = losers.length === active.length; // nobody survived -> round is void
    if (!voided) {
      for (const pid of losers) {
        this.records.get(pid).out = true;
        this.eliminatedOrder.push(this.nameOf(pid));
      }
    }
    await this.emit('reveal', {
      round: this.round,
      reason,
      correctLabel: this.correctLabel(q),
      results,
      voided,
      eliminated: voided ? [] : losers.map((p) => this.nameOf(p)),
      alive: this.activeIds().map((p) => this.nameOf(p)),
    });
    if (!voided && losers.length) await this.emit('eliminated', { players: losers.map((p) => this.nameOf(p)) });
    await this._next();
  }
  async finish() {
    if (this.over) return;
    this.over = true;
    const alive = this.activeIds();
    const winner = alive[0] ?? this.players[this.players.length - 1].id;
    const persisted = await this.persistAll();
    await this.emit('gameEnd', {
      mode: 'royale',
      winner: this.nameOf(winner),
      out: this.eliminatedOrder,
      rounds: this.round,
      persisted,
    });
  }
}

module.exports = { TrainRun, Duel, Royale, BaseGame, LABELS };
