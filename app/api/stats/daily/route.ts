import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifySession, SESSION_COOKIE } from "@/lib/session";

export const dynamic = "force-dynamic";

interface DailyStatEntry {
  userId: string;
  name: string;
  wins: number;
  correct: number;
  wrong: number;
  dayKey: string;
}

const g = globalThis as unknown as { __stoneDailyStats?: Map<string, DailyStatEntry> };
if (!g.__stoneDailyStats) g.__stoneDailyStats = new Map();
const memStats = g.__stoneDailyStats;

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function addEntry(
  map: Map<string, { name: string; wins: number; correct: number; wrong: number }>,
  id: string,
  name: string,
  wins: number,
  correct: number,
  wrong: number
) {
  const cur = map.get(id) ?? { name, wins: 0, correct: 0, wrong: 0 };
  if (name && name !== "?") cur.name = name;
  cur.wins += wins;
  cur.correct += correct;
  cur.wrong += wrong;
  map.set(id, cur);
}

// GET /api/stats/daily -> combined victories across all mini games + questions correct / wrong today
export async function GET() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const key = todayKey();
  const combined = new Map<string, { name: string; wins: number; correct: number; wrong: number }>();

  // 1. In-memory mini-game stats recorded today (Quiz Fighter, Tower Siege, Turnul, Train, PRC)
  for (const [uid, entry] of memStats.entries()) {
    if (entry.dayKey === key) {
      addEntry(combined, uid, entry.name, entry.wins, entry.correct, entry.wrong);
    }
  }

  // 2. PostgreSQL stats from today across QuizSession, TrainRun, Carciuma, Tower, and Duel
  try {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const [
      quizSessions,
      sessionAnswers,
      trainRuns,
      carciumaWins,
      carciumaAnswers,
      towerWins,
      towerAnswers,
      duelGames,
      duelAnswers,
    ] = await Promise.all([
      prisma.quizSession.findMany({
        where: { status: "COMPLETED", completedAt: { gte: startOfDay }, userId: { not: null } },
        select: { userId: true, user: { select: { displayName: true } } },
      }),
      prisma.sessionAnswer.findMany({
        where: { answeredAt: { gte: startOfDay }, quizSession: { userId: { not: null } } },
        select: {
          isCorrect: true,
          quizSession: { select: { userId: true, user: { select: { displayName: true } } } },
        },
      }),
      prisma.trainRun.findMany({
        where: { createdAt: { gte: startOfDay } },
        select: { userId: true, correct: true, total: true, user: { select: { displayName: true } } },
      }),
      prisma.carciumaGame.findMany({
        where: { status: "COMPLETED", completedAt: { gte: startOfDay }, winnerSeat: { not: null } },
        select: {
          winnerSeat: true,
          players: { select: { seat: true, userId: true, name: true } },
        },
      }),
      prisma.carciumaAnswer.findMany({
        where: { createdAt: { gte: startOfDay }, player: { userId: { not: null } } },
        select: { isCorrect: true, player: { select: { userId: true, name: true } } },
      }),
      prisma.towerGame.findMany({
        where: { status: "COMPLETED", completedAt: { gte: startOfDay }, winnerId: { not: null } },
        select: { winnerId: true },
      }),
      prisma.towerAnswer.findMany({
        where: { answeredAt: { gte: startOfDay }, player: { userId: { not: null } } },
        select: { isCorrect: true, player: { select: { userId: true, name: true } } },
      }),
      prisma.duel.findMany({
        where: { status: "COMPLETED", completedAt: { gte: startOfDay } },
        select: {
          hostId: true,
          guestId: true,
          hostScore: true,
          guestScore: true,
          host: { select: { displayName: true } },
          guest: { select: { displayName: true } },
        },
      }),
      prisma.duelAnswer.findMany({
        where: { answeredAt: { gte: startOfDay } },
        select: { userId: true, isCorrect: true },
      }),
    ]);

    for (const s of quizSessions) {
      if (s.userId) addEntry(combined, s.userId, s.user?.displayName || "?", 1, 0, 0);
    }
    for (const a of sessionAnswers) {
      const uid = a.quizSession.userId;
      if (uid) addEntry(combined, uid, a.quizSession.user?.displayName || "?", 0, a.isCorrect ? 1 : 0, a.isCorrect ? 0 : 1);
    }
    for (const r of trainRuns) {
      const wrong = Math.max(0, r.total - r.correct);
      addEntry(combined, r.userId, r.user.displayName, r.correct >= Math.ceil(r.total / 2) ? 1 : 0, r.correct, wrong);
    }
    for (const cg of carciumaWins) {
      const winner = cg.players.find((p) => p.seat === cg.winnerSeat);
      if (winner?.userId) addEntry(combined, winner.userId, winner.name, 1, 0, 0);
    }
    for (const ca of carciumaAnswers) {
      if (ca.player.userId) {
        addEntry(combined, ca.player.userId, ca.player.name, 0, ca.isCorrect ? 1 : 0, ca.isCorrect ? 0 : 1);
      }
    }
    const tWinnerIds = towerWins.map((w) => w.winnerId!).filter(Boolean);
    if (tWinnerIds.length) {
      const tps = await prisma.towerPlayer.findMany({
        where: { id: { in: tWinnerIds }, userId: { not: null } },
        select: { userId: true, name: true },
      });
      for (const p of tps) if (p.userId) addEntry(combined, p.userId, p.name, 1, 0, 0);
    }
    for (const ta of towerAnswers) {
      if (ta.player.userId) {
        addEntry(combined, ta.player.userId, ta.player.name, 0, ta.isCorrect ? 1 : 0, ta.isCorrect ? 0 : 1);
      }
    }
    for (const d of duelGames) {
      if (d.hostScore > d.guestScore) addEntry(combined, d.hostId, d.host.displayName, 1, 0, 0);
      else if (d.guestScore > d.hostScore && d.guestId) addEntry(combined, d.guestId, d.guest?.displayName || "?", 1, 0, 0);
    }
    for (const da of duelAnswers) {
      addEntry(combined, da.userId, "?", 0, da.isCorrect ? 1 : 0, da.isCorrect ? 0 : 1);
    }
  } catch {
    // Offline/no-DB mode: in-memory mini-game stats still work seamlessly!
  }

  const rows = [...combined.entries()]
    .map(([id, e]) => {
      const total = e.correct + e.wrong;
      return {
        id,
        name: e.name,
        wins: e.wins,
        correct: e.correct,
        wrong: e.wrong,
        accuracy: total ? Math.round((e.correct / total) * 100) : 0,
      };
    })
    .filter((r) => r.wins > 0 || r.correct > 0 || r.wrong > 0)
    .sort((a, b) => b.wins - a.wins || b.correct - a.correct || a.wrong - b.wrong)
    .slice(0, 15);

  return NextResponse.json({ rows });
}

// POST /api/stats/daily -> { win?: boolean, correct?: number, wrong?: number }
export async function POST(req: Request) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const win = body?.win ? 1 : 0;
  const correct = Math.max(0, Math.min(200, Number(body?.correct) || 0));
  const wrong = Math.max(0, Math.min(200, Number(body?.wrong) || 0));

  const key = todayKey();
  const prev = memStats.get(session.sub);
  if (!prev || prev.dayKey !== key) {
    memStats.set(session.sub, {
      userId: session.sub,
      name: session.name,
      wins: win,
      correct,
      wrong,
      dayKey: key,
    });
  } else {
    prev.name = session.name;
    prev.wins += win;
    prev.correct += correct;
    prev.wrong += wrong;
  }

  return NextResponse.json({ ok: true });
}
