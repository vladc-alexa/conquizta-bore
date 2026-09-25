'use strict';
// Discord transport (discord.js v14).
//
// STATUS: written, NOT yet exercised against Discord — the token was still missing
// while this was built. The engine it drives is proven by src/harness.js against the
// real question DB. First run with a token must be treated as a smoke test.
//
// Intents used: Guilds only. No Message Content — every interaction is a slash
// command, a button or a modal.
const fs = require('fs');
const path = require('path');
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  LabelBuilder,
  RadioGroupBuilder,
  ChannelType,
  ContainerBuilder,
  SeparatorBuilder,
  TextDisplayBuilder,
  MessageFlags,
} = require('discord.js');

const R = require('./rules');
const { publicQuestion, pullMixed } = require('./questions');
const { TrainRun, Duel, Royale, LABELS } = require('./engine');
const { Store } = require('./store');
const { resolveUser } = require('./identity');

const WANT_CHANNELS = [
  { key: 'train', name: 'antrenament' },
  { key: 'duel', name: '1vs1' },
];
const STATE_FILE = process.env.BOT_STATE_FILE || path.join(__dirname, '..', '.discord-channels.json');

const msgs = new Map(); // token -> { channelId, messageId }

const err = (msg) => ({ content: msg, ephemeral: true });

// Text answers ("42" typed straight into the arena channel) need the privileged Message
// Content intent, so the whole path stays behind BOT_READ_MESSAGES=1: a missing portal
// toggle must never turn into a failed login.
let TEXT_ANSWERS = false;

// State is keyed per guild: the bot may sit on several servers, and a flat map would
// make the last guild processed overwrite everyone else's channel ids.
function loadState() {
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    return raw && typeof raw.guilds === 'object' ? raw : { guilds: {} };
  } catch {
    return { guilds: {} };
  }
}
function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

/** Create #antrenament / #1vs1 if they do not exist yet, remember their ids. */
async function ensureChannels(guild, state) {
  state.guilds = state.guilds || {};
  const mine = (state.guilds[guild.id] = state.guilds[guild.id] || {});
  for (const want of WANT_CHANNELS) {
    const id = mine[want.key];
    let ch = id ? guild.channels.cache.get(id) : null;
    if (!ch) ch = guild.channels.cache.find((c) => c.name === want.name && c.type === ChannelType.GuildText);
    if (!ch) {
      ch = await guild.channels.create({ name: want.name, type: ChannelType.GuildText, reason: 'ConQuizta arena' });
      console.log(`created #${want.name} (${ch.id}) in guild ${guild.id}`);
    }
    mine[want.key] = ch.id;
  }
  saveState(state);
  return mine;
}

function commandDefs() {
  return [
    new SlashCommandBuilder().setName('antrenament').setDescription('10 întrebări, fără eliminare — intră pe clasament (PRC)'),
    new SlashCommandBuilder().setName('royale').setDescription('Battle royale: răspuns greșit sau prea lent = OUT; ultimul rămâne în joc'),
    new SlashCommandBuilder()
      .setName('duel')
      .setDescription('Duel 1 la 1, primul la 4 runde câștigate (max 7)')
      .addUserOption((o) => o.setName('adversar').setDescription('Cu cine joci').setRequired(true)),
  ].map((c) => c.toJSON());
}

// Components V2 (containers / text displays) need this flag; such a message may carry no
// embeds and no content, only components. Available in discord.js >= 14.24 (we run 14.27).
const V2 = MessageFlags.IsComponentsV2;

// token -> the question that token belongs to. The answer modal needs the stem, and a modal
// can only be built when the button is pressed (no token at render time), so cache it here.
const QCARDS = new Map();

const optionLines = (options) => options.map((o) => `${o.label} ${o.text}`).join('\n');

/** Public payload -> Discord payload. The correct answer never leaves the server.
 *  Returns BOTH shapes: `v2` (Components V2 container, nicer card) and `legacy`
 *  (classic embed) so a rejected V2 payload can still deliver the round. */
function renderQuestion({ gameId, token, round, mode, prompt, options, timeoutMs, extra }) {
  // `options` arrives as [] for rapide questions. An empty ActionRow is rejected by Discord
  // (BASE_TYPE_BAD_LENGTH: "Must be between 1 and 5 in length") — that is what killed the round.
  const isGrila = Array.isArray(options) && options.length > 0;
  const head = `Întrebarea ${round}${extra && extra.total ? `/${extra.total}` : ''} · ${mode === 'grila' ? 'grilă' : 'rapidă'}`;
  const stem = String(prompt || '').trim() || head;
  const howTo = TEXT_ANSWERS
    ? (isGrila ? 'Apasă un buton sau scrie litera (A–D).' : 'Scrie numărul direct în canal.')
    : (isGrila ? null : 'Răspunde cu un număr.');
  const accent = isGrila ? 0x5865f2 : 0xeb459e;
  const seconds = Math.round(timeoutMs / 1000);
  const tail = `${howTo ? howTo + '\n\n' : ''}⏱️ ${seconds}s${extra && extra.escalate ? ' · timp redus' : ''}`;

  const components = [];
  if (isGrila) {
    components.push(new ActionRowBuilder().addComponents(
      options.map((o) =>
        new ButtonBuilder()
          .setCustomId(`${gameId}|${token}|${o.index}`)
          .setLabel(o.label)
          .setStyle(ButtonStyle.Primary)
      )
    ));
  } else {
    // Numeric round. Typed answers ("42" straight in the channel) stay the fast path when
    // BOT_READ_MESSAGES=1, but the window is always offered: it now carries the question
    // inside, so a player who scrolled away (or is on mobile) answers what they can see.
    components.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`${gameId}|${token}|modal`)
        .setLabel(TEXT_ANSWERS ? 'Răspunde în fereastră' : 'Răspunde')
        .setStyle(TEXT_ANSWERS ? ButtonStyle.Secondary : ButtonStyle.Success)
    ));
  }

  const card = new ContainerBuilder()
    .setAccentColor(accent)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${head}\n**${stem}**`))
    .addSeparatorComponents(new SeparatorBuilder())
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`${isGrila ? optionLines(options) + '\n\n' : ''}${tail}`)
    );
  if (components.length) card.addActionRowComponents(...components);

  const embed = new EmbedBuilder()
    .setColor(accent)
    .setTitle(stem.slice(0, 250))
    .setDescription(`${[isGrila ? optionLines(options) : null, howTo].filter(Boolean).join('\n')}\n\n⏱️ ${seconds}s`)
    .setFooter({ text: `${head}${extra && extra.escalate ? '  ·  timp redus' : ''}` });

  return {
    v2: { flags: V2, components: [card] },
    legacy: { embeds: [embed], components },
  };
}

/** The answer modal. Discord allows Text Display inside modals, so the question can be shown
 *  where it is answered — a modal is private, which is exactly what an answer box wants.
 *  Documented shape (discordjs.guide/interactions/modals): <= 5 top-level components, each a
 *  Label or a Text Display, title <= 45 chars. */
function answerModal({ customId, stem, options, round, total }) {
  const isGrila = Array.isArray(options) && options.length > 0;
  const title = `Întrebarea ${round || '?'}${total ? `/${total}` : ''}`;
  const modal = new ModalBuilder().setCustomId(customId).setTitle(title.slice(0, 45));
  const body = [String(stem || '').trim() || '(întrebarea nu mai e disponibilă)'];
  if (isGrila) body.push('', ...options.map((o) => `${o.label} ${o.text}`));
  modal.addComponents(new TextDisplayBuilder().setContent(body.join('\n').slice(0, 4000)));
  modal.addComponents(
    new LabelBuilder()
      .setLabel(isGrila ? 'Răspunsul tău (A–D)' : 'Răspunsul tău')
      .setDescription(isGrila ? 'Litera variantei corecte' : 'Scrie doar numărul, fără text')
      .setTextInputComponent(
        new TextInputBuilder().setCustomId('value').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(12)
      )
  );
  return modal;
}

/** Send that logs instead of throwing: one bad payload must not end the round or kill the bot. */
async function safeSend(ch, payload) {
  try {
    return await ch.send(payload);
  } catch (e) {
    console.error(`send failed: ${e && e.message ? e.message : e}`);
    return null;
  }
}

/** Try the Components V2 card, then the embed, then the embed without its buttons.
 *  Returns { msg, v2 } so the reveal knows which shape it must edit. */
async function sendCard(ch, shapes) {
  for (const attempt of [{ p: shapes.v2, v2: true }, { p: shapes.legacy, v2: false }, { p: { embeds: shapes.legacy.embeds }, v2: false }]) {
    const msg = await safeSend(ch, attempt.p);
    if (msg) return { msg, v2: attempt.v2 };
  }
  return null;
}

const key = (gameId, round) => `${gameId}|${round}`;

/** The question for a modal that is being opened *now*. The render-time cache is the fast path;
 *  this reads the live round straight from the engine (public projection only) when the token
 *  has no cache entry, so an answer window can never open blind. */
function currentCardFor(game, token) {
  if (!game || !game.current || game.currentToken !== token) return null;
  const pub = publicQuestion(game.current);
  return {
    round: game.round,
    total: game.total || game.questionCount,
    mode: pub.mode,
    stem: pub.prompt,
    options: pub.options,
  };
}

/** Engine events -> channel messages. */
function makeEventHandler(ch, questionsFor) {
  return async (game, ev, data) => {
    if (ev === 'question') {
      const pub = data.public;
      game.channelId = ch.id; // where this game lives — the typed-answer path needs it
      QCARDS.set(data.token, { round: data.round, total: data.total, mode: pub.mode, stem: pub.prompt, options: pub.options });
      const shapes = renderQuestion({
        gameId: game.id,
        token: data.token,
        round: data.round,
        mode: pub.mode,
        prompt: pub.prompt,
        options: pub.options,
        timeoutMs: data.timeoutMs,
        extra: data,
      });
      const sent = await sendCard(ch, shapes);
      if (sent) msgs.set(key(game.id, data.round), { channelId: ch.id, messageId: sent.msg.id, v2: sent.v2 });
      return;
    }
    if (ev === 'reveal') {
      const ref = msgs.get(key(game.id, data.round));
      const lines = (data.results || []).map((r) => {
        const nm = game.nameOf(r.playerId);
        const show = r.graded.answered ? (r.graded.raw ?? '—') : 'fără răspuns';
        const mark = r.won ? '🏆' : r.graded.isCorrect ? '✔' : '✘';
        const pts = r.graded.mode === 'rapide' && r.graded.answered ? ` · ${r.graded.score} pct` : '';
        return `${mark} **${nm}** → ${show}${pts}`;
      });
      const out = data.eliminated && data.eliminated.length
        ? `**OUT:** ${data.eliminated.join(', ')}\nîn joc: ${data.alive.join(', ')}`
        : null;
      const card = new ContainerBuilder()
        .setAccentColor(0x57f287)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ✅ Răspuns corect: ${data.correctLabel}`))
        .addSeparatorComponents(new SeparatorBuilder())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n') || '—'));
      if (out) card.addTextDisplayComponents(new TextDisplayBuilder().setContent(out));
      if (data.note) card.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${data.note}`));

      const embed = new EmbedBuilder()
        .setColor(0x57f287)
        .setTitle(`Răspuns corect: ${data.correctLabel}`)
        .setDescription(lines.join('\n') || '—')
        .setFooter({ text: data.note || '' });
      if (out) embed.addFields({ name: 'OUT', value: out });
      if (ref) {
        const msg = await ch.messages.fetch(ref.messageId).catch(() => null);
        if (msg) {
          if (ref.v2) {
            // The V2 flag has to stay on the edit, a V2 message cannot become an embed.
            await msg.edit({ flags: V2, components: [card] }).catch(async (e) => {
              console.error(`reveal edit (v2) failed: ${e && e.message ? e.message : e}`);
              await msg.edit({ embeds: [embed], components: [] }).catch(() => {});
            });
          } else {
            await msg.edit({ embeds: [embed], components: [] }).catch(() => {});
          }
        }
      } else {
        const sent = await safeSend(ch, { flags: V2, components: [card] });
        if (!sent) await safeSend(ch, { embeds: [embed] });
      }
      msgs.delete(key(game.id, data.round));
      return;
    }
    if (ev === 'gameEnd') {
      for (const t of [...QCARDS.keys()]) if (t.startsWith(`${game.id}:`)) QCARDS.delete(t);
      const head =
        data.mode === 'royale' ? `👑 ${data.winner} câștigă battle royale`
        : data.mode === 'duel' ? `🏆 ${data.winner} câștigă duelul ${data.score}`
        : `Antrenament terminat: ${data.correct}/${data.total} corecte`;
      await safeSend(ch, { embeds: [new EmbedBuilder().setColor(0xfee75c).setTitle(head).setFooter({ text: 'ConQuizta · rezultatul intră în PRC' })] });
    }
  };
}

/** Solo antrenament: a private feed instead of channel messages. Every round posts its question as
 *  the NEWEST private message (so it is always the one at the bottom where the player is looking),
 *  with a countdown that ticks, and the round's result — correct answer, the player's own answer and
 *  time — lands right under it. Nothing is posted in the channel and nothing has to be clicked.
 *  (A modal cannot be opened unprompted and its content is static, so it could never tick.) */
function makePrivateEventHandler(interaction, ch) {
  let ticks = null;
  let opened = false;
  let ticking = true; // turned off if Discord refuses to update a private message
  const stopTicks = () => {
    if (ticks) {
      clearInterval(ticks);
      ticks = null;
    }
  };
  const send = async (payload) => {
    try {
      return await interaction.followUp({ ...payload, flags: V2 | MessageFlags.Ephemeral });
    } catch (e) {
      console.error(`fereastra privată: trimitere eșuată (${e && e.message ? e.message : e})`);
      // Last resort: a public card is better than a round nobody can see. Drop the ephemeral bit,
      // which is only legal on an interaction response.
      return safeSend(ch, { ...payload, flags: V2 });
    }
  };
  const editPrivate = async (messageId, payload) => {
    try {
      return await interaction.webhook.editMessage(messageId, payload);
    } catch (e) {
      if (ticking) console.error(`fereastra privată: cronometrul nu se poate actualiza (${e && e.message ? e.message : e}) — rămâne timestamp-ul relativ`);
      ticking = false;
      return null;
    }
  };

  return async (game, ev, data) => {
    if (ev === 'question') {
      const pub = data.public;
      game.channelId = ch.id;
      game.notify = (content) => interaction.followUp({ content, flags: MessageFlags.Ephemeral }).catch(() => {});
      QCARDS.set(data.token, { round: data.round, total: data.total, mode: pub.mode, stem: pub.prompt, options: pub.options });
      // Resolve the deferred placeholder once, so it stops saying "thinking…".
      if (!opened) {
        opened = true;
        interaction
          .editReply({
            flags: V2 | MessageFlags.Ephemeral,
            components: [
              new ContainerBuilder()
                .setAccentColor(0x5865f2)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## Antrenament · ${data.total || 5} întrebări`))
                .addTextDisplayComponents(new TextDisplayBuilder().setContent('-# scrie răspunsul direct în canal · cronometrul e pe fiecare întrebare')),
            ],
          })
          .catch(() => {});
      }
      const isGrila = Array.isArray(pub.options) && pub.options.length > 0;
      const deadline = Date.now() + data.timeoutMs;
      const left = () => Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      const endsAt = Math.floor(deadline / 1000);
      const row = isGrila
        ? new ActionRowBuilder().addComponents(
            ...pub.options.map((o) => new ButtonBuilder().setCustomId(`${game.id}|${data.token}|${o.index}`).setLabel(o.label).setStyle(ButtonStyle.Primary))
          )
        : new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`${game.id}|${data.token}|modal`).setLabel('Fereastră (opțional)').setStyle(ButtonStyle.Secondary)
          );
      const payload = () => {
        const c = new ContainerBuilder()
          .setAccentColor(isGrila ? 0x5865f2 : 0xeb459e)
          .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `## Întrebarea ${data.round}${data.total ? `/${data.total}` : ''} · ${isGrila ? 'grilă' : 'rapidă'}\n**${pub.prompt}**`
          ))
          .addSeparatorComponents(new SeparatorBuilder())
          .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            isGrila
              ? pub.options.map((o) => `${o.label} ${o.text}`).join('\n')
              : 'Scrie doar numărul, direct în canal — nu e nimic de apăsat.'
          ))
          .addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ⏳ rămân ${left()}s · se închide <t:${endsAt}:R>`));
        return { flags: V2 | MessageFlags.Ephemeral, components: [c, row] };
      };
      stopTicks();
      const card = payload();
      const msg = await send(card);
      if (msg && ticking) {
        // The <t:…:R> stamp already ticks client-side; these edits are the belt to that braces.
        ticks = setInterval(() => {
          if (left() <= 0) return stopTicks();
          if (!ticking) return stopTicks();
          editPrivate(msg.id, payload());
        }, 2000);
      }
      return;
    }
    if (ev === 'reveal') {
      stopTicks();
      const graded = ((data.results || [])[0] || {}).graded || {};
      const mine = graded.answered && graded.raw != null && graded.raw !== '' ? String(graded.raw) : 'fără răspuns';
      const secs = graded.elapsedMs != null ? (graded.elapsedMs / 1000).toFixed(1) : '—';
      const ok = !!graded.isCorrect;
      const c = new ContainerBuilder()
        .setAccentColor(ok ? 0x57f287 : 0xed4245)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${ok ? '✔ corect' : '✘ greșit'} · răspuns corect: ${data.correctLabel}`))
        .addSeparatorComponents(new SeparatorBuilder())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
          `răspunsul tău: **${mine}**\n⏱️ timpul tău: **${secs}s**${graded.mode === 'rapide' && graded.answered ? ` · ${graded.score} pct` : ''}`
        ));
      if (data.note) c.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${data.note}`));
      await send({ flags: V2, components: [c] });
      return;
    }
    if (ev === 'gameEnd') {
      stopTicks();
      for (const t of [...QCARDS.keys()]) if (t.startsWith(`${game.id}:`)) QCARDS.delete(t);
      const c = new ContainerBuilder()
        .setAccentColor(0xfee75c)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## Antrenament terminat: ${data.correct}/${data.total} corecte`))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
          `-# ${data.rapideMean != null ? `medie la rapide ${data.rapideMean} pct · ` : ''}rezultatul intră în PRC`
        ));
      await send({ flags: V2, components: [c] });
    }
  };
}

async function startRoyale(client, ch, prisma, store, userId, userName, state) {
  const gameId = `royale-${Date.now()}`;
  const joiners = new Map([[userId, userName]]);
  const joinRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`join|${gameId}`).setLabel('Intră în joc').setStyle(ButtonStyle.Success)
  );
  const joinMsg = await ch.send({
    embeds: [new EmbedBuilder().setColor(0xed4245).setTitle('Battle royale').setDescription(`Se strâng jucători… **${R.ROYALE.joinWindowMs / 1000}s**\nRăspuns greșit sau prea lent = OUT.`)],
    components: [joinRow],
  });
  client.joinLobbies.set(gameId, { joiners, ch });
  setTimeout(async () => {
    const lobby = client.joinLobbies.get(gameId);
    client.joinLobbies.delete(gameId);
    await joinMsg.edit({ components: [] }).catch(() => {});
    if (!lobby || lobby.joiners.size < R.ROYALE.minPlayers) {
      await ch.send({ content: 'Battle royale anulat: nu s-au strâns destui jucători.' }).catch(() => {});
      return;
    }
    const players = [];
    for (const [id, name] of lobby.joiners) {
      const u = await resolveUser(prisma, { discordId: id, displayName: name });
      players.push({ id, name, userId: u && u.id });
    }
    const qs = await pullMixed(prisma, 24, 0.6);
    const game = track(new Royale({ id: gameId, players, questions: qs, clock: realClock(), store, onEvent: makeEventHandler(ch) }));
    await game.start();
  }, R.ROYALE.joinWindowMs);
  return gameId;
}

function realClock() {
  return {
    now: () => Date.now(),
    schedule: (ms, fn) => setTimeout(fn, ms),
    cancel: (h) => clearTimeout(h),
  };
}

async function startDuel(client, ch, interaction, prisma, store) {
  const challenger = { id: interaction.user.id, name: interaction.member?.displayName || interaction.user.username };
  const target = interaction.options.getUser('adversar');
  if (target.bot || target.id === challenger.id) return interaction.editReply(err('Alege un adversar uman, diferit de tine.'));
  const gameId = `duel-${Date.now()}`;
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`da|${gameId}|${challenger.id}`).setLabel('Accept').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`nu|${gameId}|${challenger.id}`).setLabel('Refuz').setStyle(ButtonStyle.Danger)
  );
  await interaction.editReply({
    embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle('Duel').setDescription(`<@${challenger.id}> îl provoacă pe <@${target.id}>.\nPrimul la **${R.DUEL.target}** runde câștigate, max ${R.DUEL.rounds}.`)],
    components: [row],
  });
  client.duelInvites.set(gameId, { challenger, target: { id: target.id, name: target.displayName || target.username }, ch });
  return gameId;
}

async function startDuelMatch(client, inv, ch, prisma, store) {
  const players = [];
  for (const p of [inv.challenger, inv.target]) {
    const u = await resolveUser(prisma, { discordId: p.id, displayName: p.name });
    players.push({ ...p, userId: u && u.id });
  }
  const qs = await pullMixed(prisma, R.DUEL.rounds, 0.5);
  const extra = await pullMixed(prisma, R.DUEL.suddenDeathMax, 0);
  const game = track(new Duel({ id: `duel-${Date.now()}`, players, questions: qs, extraRapide: extra.filter((q) => q.mode === 'rapide'), clock: realClock(), store, onEvent: makeEventHandler(ch) }));
  await game.start();
}

// ---------------------------------------------------------------- SHEET ----
// Solo antrenament as ONE modal: Discord allows at most five top-level components per modal, so a
// sheet holds five questions, one Label each (question in the label + description, the answer
// control inside the Label). The command IS the interaction, so the sheet opens without any click
// — but a modal is static, so there is no ticking clock inside it: the time budget lives in the
// title and the player's total time comes back with the result.

const SHEET_MAX = 5;
const SHEETS = new Map(); // modal customId -> the questions it asks

/** Split a prompt so it fits a Label: head goes in the label (<=45), the rest in the description
 *  (<=100). Breaks on a word boundary when there is one, so questions stay readable. */
function splitPrompt(prompt, headMax = 41) {
  const text = String(prompt || '').trim();
  if (text.length <= headMax) return [text, 'alege răspunsul'];
  let cut = text.lastIndexOf(' ', headMax);
  if (cut < headMax * 0.6) cut = headMax;
  const head = `${text.slice(0, cut).trim()}…`;
  const tail = text.slice(cut).trim().slice(0, 100);
  return [head.slice(0, 45), tail];
}

function sheetModal(questions, seconds) {
  const modal = new ModalBuilder()
    .setCustomId(`sheet|${Date.now()}|${Math.floor(Math.random() * 1e6)}`)
    .setTitle(`Antrenament · ${questions.length} întrebări · ${seconds}s`);
  questions.forEach((q, i) => {
    const [head, tail] = splitPrompt(q.prompt);
    const label = new LabelBuilder().setLabel(`${i + 1}) ${head}`).setDescription(tail);
    if (q.mode === 'grila') {
      label.setRadioGroupComponent(
        new RadioGroupBuilder()
          .setCustomId(`q${i}`)
          .setRequired(true)
          .addOptions(...q.options.map((o, idx) => ({ label: `${LABELS[idx]}) ${o.text}`.slice(0, 100), value: String(idx) })))
      );
    } else {
      label.setTextInputComponent(
        new TextInputBuilder()
          .setCustomId(`q${i}`)
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(12)
          .setPlaceholder('doar numărul, ex. 1517')
      );
    }
    modal.addComponents(label);
  });
  return modal;
}

/** Open the sheet. Returns true when the modal was shown (the interaction is then answered). */
async function startSheet(interaction, prisma, store) {
  const qs = await pullMixed(prisma, SHEET_MAX, 0.6);
  if (!qs.length) return false;
  // Abandoned sheets (opened, never submitted) must not pile up.
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [id, s] of SHEETS) if (s.startedAt < cutoff) SHEETS.delete(id);
  const budgetMs = qs.reduce((sum, q) => sum + (q.mode === 'grila' ? R.TRAIN.grilaMs : R.TRAIN.rapideMs), 0);
  const seconds = Math.round((budgetMs * 1.5) / 1000);
  const modal = sheetModal(qs, seconds);
  const customId = modal.toJSON().custom_id;
  try {
    await interaction.showModal(modal);
  } catch (e) {
    console.error(`foaia nu a putut fi deschisă (${e && e.message ? e.message : e}) — trec pe fluxul întrebare-cu-întrebare`);
    return false;
  }
  SHEETS.set(customId, { questions: qs, startedAt: Date.now(), budgetMs: budgetMs * 1.5, playerId: interaction.user.id, userId: null, name: interaction.member?.displayName || interaction.user.username });
  console.log(`foaie deschisă: ${qs.length} întrebări, buget ${seconds}s (${customId})`);
  return true;
}

/** Grade a submitted sheet and report it privately: per question the answer, the truth, and the
 *  total time. One submit cannot carry per-question times, so the session stores the average
 *  (documented) instead of inventing a faster one. */
async function submitSheet(interaction, store, prisma) {
  const sheet = SHEETS.get(interaction.customId);
  if (!sheet) return interaction.reply(err('Foaia a expirat — rulează /antrenament din nou.'));
  SHEETS.delete(interaction.customId);
  const elapsed = Date.now() - sheet.startedAt;
  const overBudget = elapsed > sheet.budgetMs;
  const perQuestion = Math.round(elapsed / sheet.questions.length);
  const answeredAt = Date.now();
  const answers = [];
  const lines = [];
  let correct = 0;

  sheet.questions.forEach((q, i) => {
    let isCorrect = false;
    let selectedOptionId = null;
    let submittedAnswer = null;
    let shown = '—';
    if (q.mode === 'grila') {
      const value = interaction.fields.getRadioGroup(`q${i}`);
      const idx = value == null ? -1 : Number(value);
      const chosen = Number.isInteger(idx) && q.options[idx] ? q.options[idx] : null;
      isCorrect = !!chosen && idx === q.correctIndex;
      selectedOptionId = chosen ? chosen.id : null;
      shown = chosen ? LABELS[idx] : 'fără răspuns';
    } else {
      const text = String(interaction.fields.getTextInputValue(`q${i}`) || '').trim();
      const guess = Number(text);
      submittedAnswer = Number.isFinite(guess) ? String(Math.trunc(guess)) : null;
      isCorrect = Number.isFinite(guess) && R.rapideIsClose(guess, q.correctNumber);
      shown = Number.isFinite(guess) ? String(Math.trunc(guess)) : 'fără răspuns';
    }
    if (isCorrect) correct++;
    answers.push({ questionId: q.id, selectedOptionId, submittedAnswer, isCorrect, elapsedMilliseconds: perQuestion, answeredAt });
    lines.push(`${i + 1}) ${isCorrect ? '✔' : '✘'} ${shown}${isCorrect ? '' : ` · corect: ${correctAnswerFor(q)}`}`);
  });

  const record = await resolveUser(prisma, { discordId: interaction.user.id, displayName: sheet.name });
  if (!overBudget) {
    try {
      await store.finalizeGame({
        playerId: record ? record.id : null,
        mode: 'train',
        startedAt: sheet.startedAt,
        completedAt: answeredAt,
        answers,
      });
    } catch (e) {
      console.error(`foaia nu s-a putut salva: ${e && e.message ? e.message : e}`);
    }
  }

  const card = new ContainerBuilder()
    .setAccentColor(correct === sheet.questions.length ? 0x57f287 : 0x5865f2)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## Foaie: ${correct}/${sheet.questions.length} corecte`))
    .addSeparatorComponents(new SeparatorBuilder())
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `⏱️ timpul tău: **${(elapsed / 1000).toFixed(1)}s** · buget ${Math.round(sheet.budgetMs / 1000)}s\n` +
      `-# ${overBudget ? 'peste buget — sesiunea nu intră în PRC' : 'intră în PRC'}`
    ));
  console.log(`foaie trimisă: ${correct}/${sheet.questions.length} corecte în ${(elapsed / 1000).toFixed(1)}s${overBudget ? ' (peste buget)' : ''}`);
  return interaction.reply({ flags: V2 | MessageFlags.Ephemeral, components: [card] });
}

function correctAnswerFor(q, labels = LABELS) {
  return q.mode === 'grila' ? `${labels[q.correctIndex]}) ${q.options[q.correctIndex].text}` : String(q.correctNumber);
}

async function startTrain(client, ch, prisma, store, userId, userName, interaction) {
  const u = await resolveUser(prisma, { discordId: userId, displayName: userName });
  const qs = await pullMixed(prisma, R.TRAIN.questions, 0.6);
  // Solo: play in the private window opened by the command. Without an interaction (older call
  // sites, tests) fall back to the public question card.
  const onEvent = interaction ? makePrivateEventHandler(interaction, ch) : makeEventHandler(ch);
  const game = track(new TrainRun({ id: `train-${Date.now()}`, player: { id: userId, name: userName, userId: u && u.id }, questions: qs, clock: realClock(), store, onEvent }));
  await game.start();
}

async function start({ token }) {
  const prisma = new (require('@prisma/client').PrismaClient)();
  const store = new Store({ prisma, mode: process.env.BOT_STORE_MODE || 'commit', log: console.log });
  TEXT_ANSWERS = process.env.BOT_READ_MESSAGES === '1';
  const intents = [GatewayIntentBits.Guilds];
  if (TEXT_ANSWERS) intents.push(GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent);
  const client = new Client({ intents });
  // Gateway health: without these listeners a dead-but-"active" connection is invisible,
  // which is exactly how a late interaction (10062) would look from the outside.
  client.on('error', (e) => console.error('client error:', (e && e.message) || e));
  client.on('warn', (m) => console.warn('client warn:', m));
  client.on('shardDisconnect', (code, id) => console.warn(`shard ${id} deconectat (code ${code})`));
  client.on('shardReconnecting', (id) => console.warn(`shard ${id} reconectare...`));
  client.on('shardResume', (id, replayed) => console.log(`shard ${id} reluat (replay ${replayed})`));
  client.on('shardReady', (id) => console.log(`shard ${id} gata`));
  client.joinLobbies = new Map();
  client.duelInvites = new Map();

  const rest = new REST({ version: '10' }).setToken(token);

  // Slash commands are registered PER GUILD: global registration can take up to an
  // hour to show up, guild-scoped is instant. Nothing is registered globally, so the
  // command picker never shows duplicates.
  async function setupGuild(guild) {
    try {
      await rest.put(Routes.applicationGuildCommands(client.user.id, guild.id), { body: commandDefs() });
      const state = loadState();
      await ensureChannels(guild, state);
      // Visible on every start so a missing permission (e.g. Manage Messages for deleting
      // typed answers) is obvious in the journal instead of failing silently at game time.
      const perms = guild.members.me ? guild.members.me.permissions.toArray().sort().join(',') : 'n/a';
      console.log(`guild „${guild.name}" (${guild.id}) pregătit — canale: ${JSON.stringify(state)}`);
      console.log(`permisiuni: ${perms}`);
    } catch (e) {
      console.error(`guild setup failed for ${guild.id}`, e);
    }
  }

  client.once('ready', async () => {
    console.log(`logged in as ${client.user.tag} (${client.user.id})`);
    if (!client.guilds.cache.size) console.log('nu sunt încă pe niciun server — aștept invitația');
    for (const guild of client.guilds.cache.values()) await setupGuild(guild);
  });

  client.on('guildCreate', (guild) => setupGuild(guild));

  client.on('interactionCreate', async (interaction) => {
    try {
      if (interaction.isChatInputCommand()) {
        const state = loadState();
        const mine = (state.guilds || {})[interaction.guildId] || {};
        const want = interaction.commandName === 'duel' ? { key: 'duel', name: '1vs1' } : { key: 'train', name: 'antrenament' };
        // Stored id first; fall back to the channel NAME so a stale/empty state file can
        // never turn every command into a silent "wrong channel" rejection.
        const chName = interaction.channel && interaction.channel.name;
        const inRightChannel = interaction.channelId === mine[want.key] || chName === want.name;
        if (!inRightChannel) return interaction.reply(err('Comanda se folosește în canalul potrivit (#antrenament / #1vs1).'));
        // Discord's ack window is 3s: if the link is slow/dead the interaction arrives too
        // late and the reply fails with 10062. Log how late it was instead of guessing.
        const lateMs = Date.now() - interaction.createdTimestamp;
        if (lateMs > 1500) console.warn(`interaction primit cu ${lateMs}ms întârziere`);
        // Antrenament is solo, so it gets the sheet modal (falling back to the private per-question
        // feed); the duel/royale replies stay public.
        const name = interaction.member?.displayName || interaction.user.username;
        const ch = interaction.channel;
        if (interaction.commandName === 'antrenament') {
          // The sheet modal IS the initial response, so nothing may be deferred before it (3s budget).
          if (await startSheet(interaction, prisma, store)) return;
          await interaction.deferReply({ flags: MessageFlags.Ephemeral });
          return void (await startTrain(client, ch, prisma, store, interaction.user.id, name, interaction));
        }
        await interaction.deferReply();
        if (interaction.commandName === 'royale') return void (await startRoyale(client, ch, prisma, store, interaction.user.id, name, state));
        if (interaction.commandName === 'duel') return void (await startDuel(client, ch, interaction, prisma, store));
        return;
      }
      if (interaction.isButton()) {
        const [a, b, c] = interaction.customId.split('|');
        if (a === 'join') {
          const lobby = client.joinLobbies.get(b);
          if (!lobby) return interaction.reply(err('Înscrierea s-a închis.'));
          if (lobby.joiners.has(interaction.user.id)) return interaction.reply(err('Ești deja înscris.'));
          lobby.joiners.set(interaction.user.id, interaction.member?.displayName || interaction.user.username);
          return interaction.reply({ content: `Ești în joc (${lobby.joiners.size} jucători).`, ephemeral: true });
        }
        if (a === 'da' || a === 'nu') {
          const inv = client.duelInvites.get(b);
          if (!inv) return interaction.reply(err('Provocarea a expirat.'));
          if (interaction.user.id !== inv.target.id) return interaction.reply(err('Provocarea nu e pentru tine.'));
          client.duelInvites.delete(b);
          if (a === 'nu') {
            await interaction.update({ components: [] });
            return ch_send(interaction, 'Duel refuzat.');
          }
          await interaction.update({ embeds: [new EmbedBuilder().setColor(0x57f287).setTitle('Duel acceptat')], components: [] });
          return void (await startDuelMatch(client, inv, interaction.channel, prisma, store));
        }
        // game answer: <gameId>|<token>|<index|modal>
        const g = findGame(a);
        if (!g) return interaction.reply(err('Runda nu mai e activă.'));
        if (c === 'modal') {
          // Deliberately the *old* action-row shape: if Discord rejects the new
          // Text-Display/Label modal above, this still opens, so the round stays playable.
          const plain = () => {
            const m = new ModalBuilder().setCustomId(`${a}|${b}|submit`).setTitle('Răspuns numeric');
            m.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('value').setLabel('Numărul tău').setStyle(TextInputStyle.Short).setRequired(true)));
            return m;
          };
          const card = QCARDS.get(b) || currentCardFor(g.game, b);
          if (!card) {
            console.log(`modal: întrebarea lipsește pentru token=${b} (cache=${QCARDS.size}) — deschid fereastra goală`);
            return interaction.showModal(plain());
          }
          const m = answerModal({ ...card, customId: `${a}|${b}|submit` });
          console.log(`modal deschis: token=${b} componente=[${m.toJSON().components.map((c) => c.type)}]`);
          // If Discord refuses the Text Display shape (older API surface), fall back to the
          // bare numeric box instead of showing nothing.
          try {
            return await interaction.showModal(m);
          } catch (e) {
            console.error(`modal cu întrebare respins: ${e && e.message ? e.message : e}`);
            return interaction.showModal(plain());
          }
        }
        const res = await g.game.answer(interaction.user.id, { index: Number(c) }, b);
        return interaction.reply(res.ok ? { content: 'Răspuns înregistrat.', ephemeral: true } : err(res.error));
      }
      if (interaction.isModalSubmit() && interaction.customId.startsWith('sheet|')) {
        return void (await submitSheet(interaction, store, prisma));
      }
      if (interaction.isModalSubmit()) {
        const [a, b] = interaction.customId.split('|');
        const g = findGame(a);
        if (!g) return interaction.reply(err('Runda nu mai e activă.'));
        const value = interaction.fields.getTextInputValue('value');
        console.log(`modal submit: token=${b} valoare primită (${String(value).length} caractere)`);
        const res = await g.game.answer(interaction.user.id, { value }, b);
        return interaction.reply(res.ok ? { content: 'Răspuns înregistrat.', ephemeral: true } : err(res.error));
      }
    } catch (e) {
      if (e && e.code === 10062) {
        console.error('interaction expirat (10062): ack prea târziu — comanda trebuie reluată');
      } else {
        console.error('interaction error', e);
      }
    }
  });

  if (TEXT_ANSWERS) {
    // Typed answers: "42" for rapidă, "B" for grilă, right in the channel — like the site.
    client.on('messageCreate', async (msg) => {
      try {
        if (!msg.guildId || msg.author.bot) return;
        if (msg.mentions && msg.mentions.users.size) return;
        const text = (msg.content || '').trim();
        if (!text || text.startsWith('/')) return;
        for (const game of ACTIVE.values()) {
          if (game.channelId !== msg.channelId || game.over || !game.current) continue;
          if (!game.players.some((p) => p.id === msg.author.id)) continue;
          let payload = null;
          if (game.current.mode === 'grila') {
            const idx = 'ABCD'.indexOf(text.toUpperCase());
            if (text.length === 1 && idx >= 0) payload = { index: idx };
          } else if (/^-?\d+$/.test(text)) {
            payload = { value: text };
          }
          if (!payload) return; // not an answer — ignore it, never consume the round
          const res = await game.answer(msg.author.id, payload, game.currentToken);
          msg.delete().catch(() => {}); // needs Manage Messages; stays quiet without it
          if (res.ok) console.log(`răspuns tastat acceptat: „${text}" token=${game.currentToken}`);
          if (!res.ok) {
            // In the solo private window the warning goes to that window, not the channel.
            if (game.notify) return void game.notify(`${msg.author}, ${res.error}`);
            const warn = await msg.channel.send({ content: `${msg.author}, ${res.error}` }).catch(() => null);
            if (warn) setTimeout(() => warn.delete().catch(() => {}), 5000);
          }
          return;
        }
      } catch (e) {
        console.error('typed answer failed:', (e && e.message) || e);
      }
    });
  }

  await client.login(token);
}

function findGame(id) {
  for (const [gid, game] of ACTIVE) if (gid === id || game.id === id) return { id: gid, game };
  return null;
}
const ACTIVE = new Map();
function track(game) {
  ACTIVE.set(game.id, game);
  game.onEvent = ((orig) => async (g, ev, data) => {
    if (ev === 'gameEnd') ACTIVE.delete(game.id);
    return orig(g, ev, data);
  })(game.onEvent);
  return game;
}
function ch_send(interaction, content) {
  return interaction.followUp({ content }).catch(() => {});
}

module.exports = { start, track, renderQuestion, answerModal, currentCardFor, makePrivateEventHandler, makeEventHandler, __sheet: { sheetModal, submitSheet, SHEETS, splitPrompt } };

