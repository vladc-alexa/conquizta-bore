import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession, SESSION_COOKIE } from "@/lib/session";
import {
  SIEGE_LEAD_MS,
  SIEGE_NEXT_LEAD_MS,
  SIEGE_TIE_LEAD_MS,
  allHumansAnswered,
  armRound,
  evaluateRound,
  roundDeadline,
  type SiegeMode,
  type SiegeQuestion,
  type SiegeRoomLike,
  type SiegeRoundResult,
} from "@/lib/siegeRoom";
import { serveQuestion } from "@/lib/questionBank";

export const dynamic = "force-dynamic";

export type RoomGameType = "fight" | "siege" | "turnul" | "train";

export interface RoomSeat {
  seatIndex: number;
  userId: string;
  name: string;
  isBot: boolean;
  botDifficulty?: "easy" | "medium" | "hard";
  ready: boolean;
  /** siege: seat pressed START; the battle only begins when every human seat has */
  started?: boolean;
  score: number;
  lastAnswer?: {
    round: number;
    correct: boolean;
    choice?: number;
    numericGuess?: number;
    elapsedMs: number;
  };
}

export interface GameRoom {
  code: string;
  gameType: RoomGameType;
  hostId: string;
  hostName: string;
  maxSeats: number;
  status: "waiting" | "playing" | "finished";
  lang: "ro" | "en";
  createdAt: number;
  updatedAt: number;
  seats: RoomSeat[];
  currentRound: number;
  roundQuestion?: unknown;
  // ---- siege sync state (server-authoritative rounds) ----
  roundSeq?: number;
  roundMode?: SiegeMode;
  roundStartedAt?: number;
  roundAnswers?: Record<string, { seq: number; choice?: number | null; guess?: number | null; elapsedMs: number }>;
  lastResult?: SiegeRoundResult | null;
  startAt?: number;
}

export interface OnlineUser {
  userId: string;
  name: string;
  lastSeen: number;
  page?: string;
}

export interface RoomInvite {
  id: string;
  fromUserId: string;
  fromName: string;
  toUserId: string;
  roomCode: string;
  gameType: RoomGameType;
  createdAt: number;
}

const BOT_NAMES = [
  "Sir Aldric",
  "Lady Morgana",
  "Baron Vex",
  "Ironhelm",
  "Valkyria",
  "StoneGuard",
  "ShadowBlade",
  "BoreBot",
];

// Persist in globalThis across Next.js hot reloads / route calls in the same Node process
const g = globalThis as unknown as {
  __stoneRooms?: Map<string, GameRoom>;
  __stoneOnline?: Map<string, OnlineUser>;
  __stoneInvites?: RoomInvite[];
};
if (!g.__stoneRooms) g.__stoneRooms = new Map();
if (!g.__stoneOnline) g.__stoneOnline = new Map();
if (!g.__stoneInvites) g.__stoneInvites = [];

const rooms = g.__stoneRooms;
const online = g.__stoneOnline;
const invites = g.__stoneInvites;

function pruneStale() {
  const now = Date.now();
  for (const [uid, u] of online.entries()) {
    if (now - u.lastSeen > 90_000) online.delete(uid);
  }
  for (const [code, r] of rooms.entries()) {
    if (now - r.updatedAt > 30 * 60_000) rooms.delete(code);
  }
  for (let i = invites.length - 1; i >= 0; i--) {
    if (now - invites[i].createdAt > 5 * 60_000 || !rooms.has(invites[i].roomCode)) {
      invites.splice(i, 1);
    }
  }
}

function generateCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return rooms.has(code) ? generateCode() : code;
}

async function getAuth() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  if (!session) return null;
  return { userId: session.sub, name: session.name };
}

// ---------- SIEGE round engine glue ----------

function siegeState(room: GameRoom): SiegeRoomLike {
  return room as unknown as SiegeRoomLike;
}

/** Pull one question straight from the shared picker (no self-HTTP: the prod proxy blocks it). */
async function fetchSiegeQuestion(_req: Request, mode: SiegeMode, lang: "ro" | "en") {
  try {
    const data = await serveQuestion(mode, 1, lang, null);
    return ((data as { questions?: SiegeQuestion[] })?.questions?.[0] as SiegeQuestion) ?? null;
  } catch {
    return null;
  }
}

/** Serve the next question to both seats on the server clock. */
async function armSiegeRound(
  req: Request,
  room: GameRoom,
  mode: SiegeMode,
  leadMs: number,
  round: number
) {
  const q = await fetchSiegeQuestion(req, mode, room.lang);
  if (!q) return false;
  armRound(siegeState(room), q, mode, leadMs, round);
  return true;
}

/** Decide the current round (both answered, or the server deadline passed). */
async function resolveSiegeRound(req: Request, room: GameRoom) {
  const s = siegeState(room);
  if (!s.roundQuestion || s.lastResult) return;
  const ev = evaluateRound(s);
  if (ev.goToTie) {
    await armSiegeRound(req, room, "rapide", SIEGE_TIE_LEAD_MS, room.currentRound);
    return;
  }
  s.lastResult = ev.result;
  room.updatedAt = Date.now();
}

/** Cheap housekeeping run on every room read/write. */
async function tickSiege(req: Request, room: GameRoom) {
  if (room.gameType !== "siege" || room.status !== "playing") return;
  const s = siegeState(room);
  if (s.lastResult) return;
  const now = Date.now();
  if (!s.roundQuestion) {
    // a question fetch failed when the round was armed — keep retrying
    if (now >= (s.roundStartedAt || 0)) {
      await armSiegeRound(req, room, s.roundMode || "grila", 1200, room.currentRound || 1);
    }
    return;
  }
  if (now < (s.roundStartedAt || 0)) return;
  if (!allHumansAnswered(s) && now <= roundDeadline(s)) return;
  await resolveSiegeRound(req, room);
}

// GET /api/rooms -> returns online players, pending invites for me, open rooms, or a specific ?code=XXXX
export async function GET(req: Request) {
  pruneStale();
  const me = await getAuth();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const page = url.searchParams.get("page") || "/";
  online.set(me.userId, { userId: me.userId, name: me.name, lastSeen: Date.now(), page });

  const code = url.searchParams.get("code")?.toUpperCase();
  const onlinePlayers = [...online.values()].filter((u) => u.userId !== me.userId);
  const myInvites = invites.filter((inv) => inv.toUserId === me.userId);

  if (code) {
    const room = rooms.get(code);
    if (!room) return NextResponse.json({ error: "room_not_found" }, { status: 404 });
    await tickSiege(req, room);
    return NextResponse.json({
      room,
      serverNow: Date.now(),
      onlinePlayers,
      invites: myInvites,
      me,
    });
  }

  const openRooms = [...rooms.values()]
    .filter((r) => r.status === "waiting" && r.seats.length < r.maxSeats)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 12);

  return NextResponse.json({ onlinePlayers, invites: myInvites, openRooms, me });
}

// POST /api/rooms -> create | join | leave | fillBots | addBot | removeSeat | invite | dismissInvite | start | submitAnswer
export async function POST(req: Request) {
  pruneStale();
  const me = await getAuth();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  online.set(me.userId, { userId: me.userId, name: me.name, lastSeen: Date.now() });

  const body = await req.json().catch(() => null);
  const action = String(body?.action || "");

  if (action === "create") {
    const gameType = (["fight", "siege", "turnul", "train"].includes(body?.gameType)
      ? body.gameType
      : "siege") as RoomGameType;
    const defaultMax = gameType === "turnul" ? 6 : gameType === "train" ? 4 : 2;
    const maxSeats = Math.min(Math.max(Number(body?.maxSeats) || defaultMax, 2), 6);
    const code = generateCode();
    const room: GameRoom = {
      code,
      gameType,
      hostId: me.userId,
      hostName: me.name,
      maxSeats,
      status: "waiting",
      lang: body?.lang === "en" ? "en" : "ro",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      currentRound: 0,
      seats: [
        {
          seatIndex: 0,
          userId: me.userId,
          name: me.name,
          isBot: false,
          ready: true,
          score: 0,
        },
      ],
    };
    rooms.set(code, room);
    return NextResponse.json({ room });
  }

  const code = String(body?.code || "").toUpperCase();
  if (action === "dismissInvite") {
    const inviteId = String(body?.inviteId || "");
    const idx = invites.findIndex((i) => i.id === inviteId && i.toUserId === me.userId);
    if (idx >= 0) invites.splice(idx, 1);
    return NextResponse.json({ ok: true });
  }

  const room = rooms.get(code);
  if (!room) return NextResponse.json({ error: "room_not_found" }, { status: 404 });
  room.updatedAt = Date.now();

  if (action === "join") {
    const existing = room.seats.find((s) => s.userId === me.userId);
    if (!existing) {
      // If full of bots, replace the last bot seat with the real human player!
      if (room.seats.length >= room.maxSeats) {
        const botIdx = room.seats.findLastIndex((s) => s.isBot);
        if (botIdx >= 0) {
          room.seats[botIdx] = {
            seatIndex: botIdx,
            userId: me.userId,
            name: me.name,
            isBot: false,
            ready: true,
            score: 0,
          };
        } else {
          return NextResponse.json({ error: "room_full" }, { status: 409 });
        }
      } else {
        room.seats.push({
          seatIndex: room.seats.length,
          userId: me.userId,
          name: me.name,
          isBot: false,
          ready: true,
          score: 0,
        });
      }
    }
    // Clear any invite for this room to this user
    for (let i = invites.length - 1; i >= 0; i--) {
      if (invites[i].toUserId === me.userId && invites[i].roomCode === code) {
        invites.splice(i, 1);
      }
    }
    return NextResponse.json({ room });
  }

  if (action === "addBot" || action === "fillBots") {
    const diff = (["easy", "medium", "hard"].includes(body?.difficulty)
      ? body.difficulty
      : "medium") as "easy" | "medium" | "hard";
    const usedNames = new Set(room.seats.map((s) => s.name));
    const countToAdd = action === "fillBots" ? room.maxSeats - room.seats.length : 1;
    for (let k = 0; k < countToAdd; k++) {
      if (room.seats.length >= room.maxSeats) break;
      const pick = BOT_NAMES.find((b) => !usedNames.has(b)) || `Bot ${room.seats.length + 1}`;
      usedNames.add(pick);
      room.seats.push({
        seatIndex: room.seats.length,
        userId: `bot-${code}-${Date.now()}-${k}`,
        name: pick,
        isBot: true,
        botDifficulty: diff,
        ready: true,
        score: 0,
      });
    }
    return NextResponse.json({ room });
  }

  if (action === "removeSeat") {
    const idx = Number(body?.seatIndex);
    if (idx > 0 && idx < room.seats.length) {
      room.seats.splice(idx, 1);
      room.seats.forEach((s, i) => (s.seatIndex = i));
    }
    return NextResponse.json({ room });
  }

  if (action === "invite") {
    const toUserId = String(body?.toUserId || "");
    if (!toUserId || toUserId === me.userId) {
      return NextResponse.json({ error: "invalid_target" }, { status: 400 });
    }
    const already = invites.find((i) => i.toUserId === toUserId && i.roomCode === code);
    if (!already) {
      invites.push({
        id: `inv-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        fromUserId: me.userId,
        fromName: me.name,
        toUserId,
        roomCode: code,
        gameType: room.gameType,
        createdAt: Date.now(),
      });
    }
    return NextResponse.json({ ok: true, room });
  }

  if (action === "start") {
    // SIEGE: START is a ready-check. The battle begins only when EVERY human
    // seat has pressed it, and then on one shared server timestamp.
    if (room.gameType === "siege") {
      const seat = room.seats.find((s) => s.userId === me.userId);
      if (!seat) return NextResponse.json({ error: "not_seated" }, { status: 400 });
      if (room.status === "waiting") seat.started = true;

      const humans = room.seats.filter((s) => !s.isBot);
      const ready = humans.length > 0 && humans.every((s) => s.started);
      if (room.status === "waiting" && ready && room.seats.length >= 2) {
        room.status = "playing";
        room.currentRound = 1;
        for (const s of room.seats) s.lastAnswer = undefined;
        await armSiegeRound(req, room, "grila", SIEGE_LEAD_MS, 1);
        room.startAt = room.roundStartedAt;
      }
      return NextResponse.json({ room, serverNow: Date.now() });
    }

    room.status = "playing";
    room.currentRound = 1;
    if (body?.question) room.roundQuestion = body.question;
    return NextResponse.json({ room });
  }

  // SIEGE: called by both clients after the catapult animation. Idempotent —
  // only the first caller for a given round number advances the match.
  if (action === "advance") {
    if (room.gameType !== "siege") return NextResponse.json({ error: "bad_action" }, { status: 400 });
    const round = Number(body?.round) || 0;
    if (room.status !== "playing" || !room.lastResult) {
      return NextResponse.json({ room, serverNow: Date.now() });
    }
    if (room.lastResult.round !== round || round !== room.currentRound) {
      return NextResponse.json({ room, serverNow: Date.now() });
    }
    room.currentRound = round + 1;
    room.lastResult = null;
    for (const s of room.seats) s.lastAnswer = undefined;
    await armSiegeRound(req, room, "grila", SIEGE_NEXT_LEAD_MS, room.currentRound);
    return NextResponse.json({ room, serverNow: Date.now() });
  }

  if (action === "nextRound") {
    room.currentRound = Number(body?.round) || room.currentRound + 1;
    room.roundQuestion = body?.question ?? null;
    for (const s of room.seats) {
      s.lastAnswer = undefined;
    }
    return NextResponse.json({ room });
  }

  if (action === "submitAnswer") {
    if (room.gameType === "siege") {
      const s = siegeState(room);
      const seat = room.seats.find((x) => x.userId === me.userId);
      const seq = Number(body?.seq) || 0;
      if (!seat || room.status !== "playing" || !s.roundQuestion) {
        return NextResponse.json({ room, serverNow: Date.now() });
      }
      if (seq !== s.roundSeq || s.lastResult) {
        return NextResponse.json({ room, serverNow: Date.now() });
      }
      s.roundAnswers[me.userId] = {
        seq,
        choice: typeof body?.choice === "number" ? body.choice : null,
        guess: typeof body?.guess === "number" ? body.guess : null,
        elapsedMs: Math.min(Math.max(Number(body?.elapsedMs) || 0, 0), roundDeadline(s) - s.roundStartedAt),
      };
      seat.lastAnswer = {
        round: room.currentRound,
        correct: false,
        choice: typeof body?.choice === "number" ? body.choice : undefined,
        numericGuess: typeof body?.guess === "number" ? body.guess : undefined,
        elapsedMs: s.roundAnswers[me.userId].elapsedMs,
      };
      if (allHumansAnswered(s)) await resolveSiegeRound(req, room);
      return NextResponse.json({ room, serverNow: Date.now() });
    }

    const seat = room.seats.find((s) => s.userId === me.userId);
    if (seat) {
      seat.lastAnswer = {
        round: room.currentRound,
        correct: Boolean(body?.correct),
        choice: typeof body?.choice === "number" ? body.choice : undefined,
        numericGuess: typeof body?.numericGuess === "number" ? body.numericGuess : undefined,
        elapsedMs: Number(body?.elapsedMs) || 5000,
      };
      if (body?.correct) seat.score += 1;
    }
    return NextResponse.json({ room });
  }

  // SIEGE: rematch — everyone must press START again.
  if (action === "reset") {
    if (room.gameType !== "siege") return NextResponse.json({ error: "bad_action" }, { status: 400 });
    const seat = room.seats.find((s) => s.userId === me.userId);
    if (!seat) return NextResponse.json({ error: "not_seated" }, { status: 400 });
    room.status = "waiting";
    room.currentRound = 0;
    room.roundSeq = 0;
    room.roundQuestion = null;
    room.roundAnswers = {};
    room.lastResult = null;
    room.roundStartedAt = 0;
    room.startAt = undefined;
    for (const s of room.seats) {
      s.started = false;
      s.lastAnswer = undefined;
    }
    return NextResponse.json({ room, serverNow: Date.now() });
  }

  if (action === "leave") {
    const idx = room.seats.findIndex((s) => s.userId === me.userId);
    if (idx >= 0) {
      room.seats.splice(idx, 1);
      room.seats.forEach((s, i) => (s.seatIndex = i));
    }
    if (room.seats.filter((s) => !s.isBot).length === 0) {
      rooms.delete(code);
      return NextResponse.json({ deleted: true });
    }
    return NextResponse.json({ room });
  }

  return NextResponse.json({ error: "unknown_action" }, { status: 400 });
}
