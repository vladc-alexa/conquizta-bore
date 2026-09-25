'use strict';
// Local E2E of the solo private window: drives a real TrainRun (real questions from the DB, real
// clock) through makePrivateEventHandler with a fake interaction, and prints every payload the
// player would see — question cards with the ticking countdown, then the result cards with their
// own answer and time. Run: node --env-file=.env scripts/private-window-test.js
const { PrismaClient } = require('@prisma/client');
const { TrainRun } = require('../src/engine');
const { makePrivateEventHandler } = require('../src/discord-transport');
const { pullMixed } = require('../src/questions');

const t0 = Date.now();
const clock = {
  now: () => Date.now() - t0,
  schedule: (ms, fn) => setTimeout(fn, ms),
  cancel: (id) => clearTimeout(id),
};

const log = [];
const fakeInteraction = {
  editReply: async (p) => {
    log.push(['window (question)', p]);
    return { id: 'win' };
  },
  followUp: async (p) => {
    log.push(['private result', p]);
    return { id: `f${log.length}` };
  },
};
const fakeCh = { id: 'chan-1', send: async (p) => (log.push(['channel(!) ', p]), { id: 'c' }) };

const texts = (p) => (p.components || []).flatMap((c) => c.components || []).filter((x) => x.data && x.data.content).map((x) => x.data.content);

(async () => {
  const prisma = new PrismaClient();
  const questions = await pullMixed(prisma, 5, 0.6);
  const userId = 'test-user';
  const game = new TrainRun({
    id: `train-${Date.now()}`,
    player: { id: userId, name: 'Vlad' },
    questions,
    clock,
    store: { finalizeGame: async () => ({ ok: true }) },
    onEvent: makePrivateEventHandler(fakeInteraction, fakeCh),
  });
  await game.start();

  // play: answer round 1 late enough that the countdown ticks are visible, the rest ~1.3s in
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setTimeout(r, i === 0 ? 5400 : 1300));
    if (!game.current) break;
    const payload = game.current.mode === 'grila' ? { index: game.current.correctIndex } : { value: String(game.current.correctNumber) };
    const res = await game.answer(userId, payload, game.currentToken);
    if (!res.ok) console.log(`  (runda ${i + 1} refuzată: ${res.error})`);
  }
  await new Promise((r) => setTimeout(r, 400));
  await prisma.$disconnect();

  let windowCount = 0;
  for (const [kind, p] of log) {
    if (kind.startsWith('window')) windowCount++;
    console.log(`\n--- ${kind} (flags=${p.flags}) ---`);
    for (const t of texts(p)) console.log(t.split('\n').map((l) => `    ${l}`).join('\n'));
  }
  const edits = log.filter(([k]) => k.startsWith('window')).length;
  const results = log.filter(([k]) => k.startsWith('private')).length;
  const channelJunk = log.filter(([k]) => k.startsWith('channel')).length;
  console.log(`\nwindow edits=${edits}  private results=${results}  channel messages=${channelJunk}`);
  console.log(channelJunk === 0 ? 'OK: nimic nu ajunge în canal (fereastră privată)' : 'PROBLEMĂ: s-a scris în canal');
})();
