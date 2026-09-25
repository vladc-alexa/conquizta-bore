'use strict';
// Local E2E of the solo private feed: drives a real TrainRun (real questions from the DB, real
// clock) through makePrivateEventHandler with a fake interaction, and prints the private messages
// in the order a player would see them — plus what the bot tried to put in the channel.
//   node --env-file=.env scripts/private-window-test.js
const { PrismaClient } = require('@prisma/client');
const { TrainRun } = require('../src/engine');
const { makePrivateEventHandler } = require('../src/discord-transport');
const { pullMixed } = require('../src/questions');

const texts = (p) =>
  (p.components || [])
    .flatMap((c) => (c.toJSON ? c.toJSON() : c).components || [])
    .filter((c) => c.type === 10)
    .map((c) => c.content);

(async () => {
  const prisma = new PrismaClient();
  const userId = 'test-user';
  const timeline = [];
  let nextId = 1;
  const messages = new Map();

  const interaction = {
    editReply: async (p) => {
      messages.set('placeholder', { ...p, id: 'placeholder' });
      timeline.push(['edit (placeholder)', 'placeholder', p]);
      return messages.get('placeholder');
    },
    followUp: async (p) => {
      const id = `m${nextId++}`;
      messages.set(id, { ...p, id });
      timeline.push(['send', id, p]);
      return messages.get(id);
    },
    webhook: {
      editMessage: async (id, p) => {
        messages.set(id, { ...p, id });
        timeline.push(['tick', id, p]);
        return messages.get(id);
      },
    },
  };
  const ch = {
    id: 'chan',
    send: async (p) => {
      timeline.push(['CHANNEL', 'chan', p]);
      return { id: 'chan-1' };
    },
  };

  const questions = await pullMixed(prisma, 5, 0.6);
  const clock = {
    now: () => Date.now() - t0,
    schedule: (ms, fn) => setTimeout(fn, ms),
    cancel: (id) => clearTimeout(id),
  };
  const t0 = Date.now();
  const game = new TrainRun({
    id: `train-${Date.now()}`,
    player: { id: userId, name: 'Tester' },
    questions,
    clock,
    store: { finalizeGame: async () => ({ ok: true }) },
    onEvent: makePrivateEventHandler(interaction, ch),
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
  await new Promise((r) => setTimeout(r, 600));

  console.log(`\n=== ce vede jucătorul, în ordine (${timeline.length} intrări) ===`);
  for (const [kind, id, p] of timeline) {
    const body = p.content ? `text: ${p.content}` : texts(p).join(' | ').replace(/\n/g, ' ⏎ ');
    console.log(`[${kind.padEnd(17)}] ${id.padEnd(12)} ${body.slice(0, 150)}`);
  }

  const questionsSent = timeline.filter(([k, , p]) => k === 'send' && texts(p).some((t) => t.includes('Întrebarea')));
  const results = timeline.filter(([k, , p]) => k === 'send' && texts(p).some((t) => t.includes('răspuns corect') || t.includes('timpul tău')));
  const ticks = timeline.filter(([k]) => k === 'tick');
  const channel = timeline.filter(([k]) => k === 'CHANNEL');
  console.log(`\nîntrebări trimise=${questionsSent.length}  rezultate=${results.length}  tick-uri cronometru=${ticks.length}  mesaje în canal=${channel.length}`);
  const tickIds = [...new Set(ticks.map(([, id]) => id))];
  const qIds = questionsSent.map(([, id]) => id);
  console.log(`tick-urile ating mesajele întrebărilor: ${tickIds.every((id) => qIds.includes(id)) ? 'da' : `NU (${tickIds} vs ${qIds})`}`);
  console.log(`ordinea e întrebare→rezultat, mereu la final: ${qIds.length === 5 && results.length === 5 && channel.length === 0 ? 'da' : 'NU'}`);
  await prisma.$disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
