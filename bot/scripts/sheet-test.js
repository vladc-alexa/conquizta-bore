'use strict';
// Local E2E of the sheet: builds the real sheet modal from real DB questions, then grades a
// submitted sheet exactly like the modal-submit handler does and prints what the player sees.
// Run: node --env-file=.env scripts/sheet-test.js

const { PrismaClient } = require('@prisma/client');
const { pullMixed } = require('../src/questions');

process.env.BOT_STORE_MODE = 'dry';
const transport = require('../src/discord-transport');
const { Store } = require('../src/store');

const texts = (payload) => {
  const p = typeof payload.toJSON === 'function' ? payload.toJSON() : payload;
  const out = [];
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (typeof node.content === 'string') out.push(node.content);
    for (const kid of node.components || []) walk(typeof kid.toJSON === 'function' ? kid.toJSON() : kid);
  };
  walk(p);
  return out;
};

(async () => {
  const prisma = new PrismaClient();
  const store = new Store({ prisma, mode: 'dry', log: () => {} });
  const qs = await pullMixed(prisma, 5, 0.6);
  const modal = transport.__sheet.sheetModal(qs, 100);
  const json = modal.toJSON();

  console.log(`titlu: "${json.title}" (${json.title.length}/45)`);
  console.log(`componente de nivel 1: ${json.components.length}/5`);
  json.components.forEach((c, i) => {
    const inner = c.component || {};
    const opts = inner.options ? inner.options.map((o) => o.label).join(' | ') : '';
    console.log(`\n[${i + 1}] label="${c.label}" (${String(c.label).length}/45)`);
    console.log(`    descriere="${c.description}" (${String(c.description).length}/100)`);
    console.log(`    control: type=${inner.type} custom_id=${inner.custom_id}${opts ? `\n    variante: ${opts}` : ''}`);
  });
  const short = json.components.filter((c, i) => String(qs[i].prompt).length > String(c.label).length + String(c.description).length);
  console.log(`\nîntrebări scurtate: ${short.length}`);

  // Now submit it as if the player had answered: right on the first try, almost right on the rest.
  const fields = {
    getRadioGroup: (id) => {
      const q = qs[Number(String(id).slice(1))];
      return String(q.correctIndex);
    },
    getTextInputValue: (id) => {
      const i = Number(String(id).slice(1));
      const q = qs[i];
      return i === 0 ? String(q.correctNumber) : String(Number(q.correctNumber) + 40);
    },
  };
  const customId = json.custom_id;
  transport.__sheet.SHEETS.set(customId, {
    questions: qs,
    startedAt: Date.now() - 42_300,
    budgetMs: 105_000,
    playerId: 'test-user',
    name: 'test',
  });
  let replied = null;
  const interaction = {
    customId,
    user: { id: 'test-user' },
    member: { displayName: 'test' },
    fields,
    reply: async (p) => { replied = p; return {}; },
  };
  await transport.__sheet.submitSheet(interaction, store, prisma);
  console.log(`\n=== ce vede jucătorul la trimitere (flags=${replied.flags}) ===`);
  for (const t of texts(replied)) console.log(t.replace(/\n/g, '\n   '));
  await prisma.$disconnect();
})();
