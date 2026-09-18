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
  ChannelType,
} = require('discord.js');

const R = require('./rules');
const { TrainRun, Duel, Royale, LABELS } = require('./engine');
const { pullMixed } = require('./questions');
const { Store } = require('./store');
const { resolveUser } = require('./identity');

const WANT_CHANNELS = [
  { key: 'train', name: 'antrenament' },
  { key: 'duel', name: '1vs1' },
];
const STATE_FILE = process.env.BOT_STATE_FILE || path.join(__dirname, '..', '.discord-channels.json');

const msgs = new Map(); // token -> { channelId, messageId }

const err = (msg) => ({ content: msg, ephemeral: true });

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

/** Public payload -> Discord embed + components. The correct answer never leaves the server. */
function renderQuestion({ gameId, token, round, mode, prompt, options, timeoutMs, extra }) {
  // `options` arrives as [] for rapide questions. An empty ActionRow is rejected by Discord
  // (BASE_TYPE_BAD_LENGTH: "Must be between 1 and 5 in length") — that is what killed the round.
  const isGrila = Array.isArray(options) && options.length > 0;
  const head = `Întrebarea ${round}${extra && extra.total ? `/${extra.total}` : ''} · ${mode === 'grila' ? 'grilă' : 'rapidă'}`;
  const stem = String(prompt || '').trim() || head;
  const embed = new EmbedBuilder()
    .setColor(isGrila ? 0x5865f2 : 0xeb459e)
    .setTitle(stem.slice(0, 250))
    .setDescription(`${isGrila ? options.map((o) => `${o.label} ${o.text}`).join('\n') : 'Răspunde cu un număr.'}\n\n⏱️ ${Math.round(timeoutMs / 1000)}s`)
    .setFooter({ text: `${head}${extra && extra.escalate ? '  ·  timp redus' : ''}` });

  let row;
  if (isGrila) {
    row = new ActionRowBuilder().addComponents(
      options.map((o) =>
        new ButtonBuilder()
          .setCustomId(`${gameId}|${token}|${o.index}`)
          .setLabel(o.label)
          .setStyle(ButtonStyle.Primary)
      )
    );
  } else {
    row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`${gameId}|${token}|modal`).setLabel('Răspunde').setStyle(ButtonStyle.Success)
    );
  }
  return { embeds: [embed], components: [row] };
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

const key = (gameId, round) => `${gameId}|${round}`;

/** Engine events -> channel messages. */
function makeEventHandler(ch, questionsFor) {
  return async (game, ev, data) => {
    if (ev === 'question') {
      const pub = data.public;
      const payload = renderQuestion({
        gameId: game.id,
        token: data.token,
        round: data.round,
        mode: pub.mode,
        prompt: pub.prompt,
        options: pub.options,
        timeoutMs: data.timeoutMs,
        extra: data,
      });
      let sent = await safeSend(ch, payload);
      if (!sent) sent = await safeSend(ch, { embeds: payload.embeds }); // retry without buttons
      if (sent) msgs.set(key(game.id, data.round), { channelId: ch.id, messageId: sent.id });
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
      const embed = new EmbedBuilder()
        .setColor(0x57f287)
        .setTitle(`Răspuns corect: ${data.correctLabel}`)
        .setDescription(lines.join('\n') || '—')
        .setFooter({ text: data.note || '' });
      if (data.eliminated && data.eliminated.length) embed.addFields({ name: 'OUT', value: `${data.eliminated.join(', ')}\nîn joc: ${data.alive.join(', ')}` });
      if (ref) {
        const msg = await ch.messages.fetch(ref.messageId).catch(() => null);
        if (msg) await msg.edit({ embeds: [embed], components: [] }).catch(() => {});
      } else {
        await ch.send({ embeds: [embed] });
      }
      return;
    }
    if (ev === 'gameEnd') {
      const head =
        data.mode === 'royale' ? `👑 ${data.winner} câștigă battle royale`
        : data.mode === 'duel' ? `🏆 ${data.winner} câștigă duelul ${data.score}`
        : `Antrenament terminat: ${data.correct}/${data.total} corecte`;
      await safeSend(ch, { embeds: [new EmbedBuilder().setColor(0xfee75c).setTitle(head).setFooter({ text: 'ConQuizta · rezultatul intră în PRC' })] });
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

async function startTrain(client, ch, prisma, store, userId, userName) {
  const u = await resolveUser(prisma, { discordId: userId, displayName: userName });
  const qs = await pullMixed(prisma, R.TRAIN.questions, 0.6);
  const game = track(new TrainRun({ id: `train-${Date.now()}`, player: { id: userId, name: userName, userId: u && u.id }, questions: qs, clock: realClock(), store, onEvent: makeEventHandler(ch) }));
  await game.start();
}

async function start({ token }) {
  const prisma = new (require('@prisma/client').PrismaClient)();
  const store = new Store({ prisma, mode: process.env.BOT_STORE_MODE || 'commit', log: console.log });
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
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
      console.log(`guild „${guild.name}" (${guild.id}) pregătit — canale: ${JSON.stringify(state)}`);
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
        await interaction.deferReply();
        const name = interaction.member?.displayName || interaction.user.username;
        const ch = interaction.channel;
        if (interaction.commandName === 'antrenament') return void (await startTrain(client, ch, prisma, store, interaction.user.id, name));
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
          const modal = new ModalBuilder().setCustomId(`${a}|${b}|submit`).setTitle('Răspuns numeric');
          modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('value').setLabel('Numărul tău').setStyle(TextInputStyle.Short).setRequired(true)));
          return interaction.showModal(modal);
        }
        const res = await g.game.answer(interaction.user.id, { index: Number(c) }, b);
        return interaction.reply(res.ok ? { content: 'Răspuns înregistrat.', ephemeral: true } : err(res.error));
      }
      if (interaction.isModalSubmit()) {
        const [a, b] = interaction.customId.split('|');
        const g = findGame(a);
        if (!g) return interaction.reply(err('Runda nu mai e activă.'));
        const value = interaction.fields.getTextInputValue('value');
        const res = await g.game.answer(interaction.user.id, { value }, b);
        return interaction.reply(res.ok ? { content: 'Răspuns înregistrat.', ephemeral: true } : err(res.error));
      }
    } catch (e) {
      console.error('interaction error', e);
    }
  });

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

module.exports = { start, track };

