'use strict';
// E2E probe for the question card. Posts the REAL payloads produced by
// src/discord-transport.renderQuestion to a throwaway channel, edits them exactly like the
// reveal does (V2 flag preserved), then deletes everything. Proves Discord accepts the
// Components V2 container + the V2 edit — the two things that can silently fail in prod.
//
// Run: node --env-file=.env scripts/card-probe.js <GUILD_ID>
const { REST, Routes, ChannelType } = require('discord.js');
const { renderQuestion, answerModal } = require('../src/discord-transport');

const V2 = 1 << 15;
const token = process.env.DISCORD_TOKEN;
const guildId = process.argv[2];
if (!token || !guildId) {
  console.error('usage: node --env-file=.env scripts/card-probe.js <GUILD_ID>');
  process.exit(2);
}
const rest = new REST({ version: '10' }).setToken(token);

const grila = {
  mode: 'grila',
  prompt: 'Care este capitala Australiei?',
  options: [
    { index: 0, label: 'A)', text: 'Sydney' },
    { index: 1, label: 'B)', text: 'Melbourne' },
    { index: 2, label: 'C)', text: 'Canberra' },
    { index: 3, label: 'D)', text: 'Perth' },
  ],
};
const rapide = {
  mode: 'rapide',
  prompt: 'În ce an a avut loc Marea Unire de la Alba Iulia?',
  options: [],
};

const revealCard = (label) => ({
  flags: V2,
  components: [
    {
      type: 17,
      accent_color: 0x57f287,
      components: [
        { type: 10, content: `## ✅ Răspuns corect: ${label}` },
        { type: 14 },
        { type: 10, content: '🏆 **dalimagic** → A)\n✘ **alt jucător** → fără răspuns' },
        { type: 10, content: '-# probă tehnică' },
      ],
    },
  ],
});

(async () => {
  let chId = null;
  const failures = [];
  try {
    const ch = await rest.post(Routes.guildChannels(guildId), {
      body: { name: 'zz-card-probe', type: ChannelType.GuildText, topic: 'throwaway — card payload probe' },
    });
    chId = ch.id;
    console.log(`probe channel ${chId}`);

    const cases = [
      ['grila / v2', grila, 25000, { total: 5 }],
      ['rapide / v2', rapide, 40000, { total: 5, escalate: true }],
    ];
    for (const [name, q, timeoutMs, extra] of cases) {
      const shapes = renderQuestion({
        gameId: 'probe', token: 'probe:1', round: 1, mode: q.mode,
        prompt: q.prompt, options: q.options, timeoutMs, extra,
      });
      // 1. send the Components V2 card
      let msg;
      try {
        msg = await rest.post(Routes.channelMessages(chId), { body: shapes.v2 });
        console.log(`OK  send v2   ${name}  id=${msg.id}  flags=${msg.flags}`);
      } catch (e) {
        failures.push(`send v2 ${name}: ${e.message} ${JSON.stringify(e.rawError || {})}`);
        console.log(`FAIL send v2  ${name}: ${e.message} ${JSON.stringify(e.rawError || {})}`);
      }
      // 2. edit it the way reveal does (V2 flag must be re-sent)
      if (msg) {
        try {
          const edited = await rest.patch(Routes.channelMessage(chId, msg.id), { body: revealCard('C) Canberra') });
          console.log(`OK  edit v2   ${name}  flags=${edited.flags}`);
        } catch (e) {
          failures.push(`edit v2 ${name}: ${e.message} ${JSON.stringify(e.rawError || {})}`);
          console.log(`FAIL edit v2  ${name}: ${e.message} ${JSON.stringify(e.rawError || {})}`);
        }
      }
      // 3. legacy fallback shape must still work (plain embed + buttons)
      try {
        const lm = await rest.post(Routes.channelMessages(chId), { body: shapes.legacy });
        await rest.patch(Routes.channelMessage(chId, lm.id), { body: { embeds: [shapes.legacy.embeds[0]], components: [] } });
        console.log(`OK  legacy    ${name}  id=${lm.id}`);
      } catch (e) {
        failures.push(`legacy ${name}: ${e.message} ${JSON.stringify(e.rawError || {})}`);
        console.log(`FAIL legacy   ${name}: ${e.message} ${JSON.stringify(e.rawError || {})}`);
      }
    }

    // 4. modal shape: structural assertions (a modal can only be sent as an interaction response)
    const modal = answerModal({ customId: 'probe:1|submit', stem: grila.prompt, options: grila.options, round: 3, total: 5 }).toJSON();
    const types = modal.components.map((c) => c.type);
    const inner = (modal.components.find((c) => c.type === 18) || {}).component || {};
    console.log(`modal json: title="${modal.title}" (${modal.title.length} chars) top-level=${modal.components.length} types=[${types}]`);
    console.log(`modal inner input: custom_id=${inner.custom_id} style=${inner.style} max_length=${inner.max_length}`);
    if (modal.title.length > 45) failures.push('modal title > 45 chars');
    if (modal.components.length > 5) failures.push('modal > 5 top-level components');
    if (!types.includes(10)) failures.push('modal lost its text display');
    if (!types.includes(18)) failures.push('modal input is not wrapped in a Label (type 18)');
    if (inner.custom_id !== 'value') failures.push(`modal input custom_id is ${inner.custom_id}, the submit handler reads "value"`);
    const rapideModal = answerModal({ customId: 'probe:2|submit', stem: rapide.prompt, options: [], round: 1, total: 5 }).toJSON();
    console.log(`rapide modal: title="${rapideModal.title}" types=[${rapideModal.components.map((c) => c.type)}]`);
  } finally {
    if (chId) {
      await rest.delete(Routes.channel(chId)).then(() => console.log('probe channel deleted')).catch((e) => console.log(`cleanup failed: ${e.message}`));
    }
  }
  console.log(failures.length ? `\nRESULT: ${failures.length} FAILURE(S)\n - ${failures.join('\n - ')}` : '\nRESULT: all payloads accepted by Discord');
  process.exit(failures.length ? 1 : 0);
})();
