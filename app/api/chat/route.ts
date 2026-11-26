import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifySession, SESSION_COOKIE } from "@/lib/session";
import { DEFAULT_CHAT_COLOR } from "@/lib/chatColors";
import { normalizeMessage } from "@/lib/messageText";
import { findMentionedNames } from "@/lib/mentions";
import { chatNames } from "@/lib/chatNames";
import { getClientIp, getIpRule, touchUserIp } from "@/lib/ip";
import { checkChatSpam } from "@/lib/chatSpam";

const CHAT_PAGE = 100;

export async function GET(req: Request) {
  try {
    const sinceParam = new URL(req.url).searchParams.get("since");
    const sinceDate = sinceParam ? new Date(sinceParam) : null;
    const delta = !!sinceDate && !Number.isNaN(sinceDate.getTime());

    const select = {
      id: true,
      authorName: true,
      text: true,
      createdAt: true,
      editedAt: true,
      userId: true,
      user: { select: { nameColor: true, isMuted: true } },
      replyTo: { select: { id: true, authorName: true, text: true } },
    } as const;

    const raw = await prisma.chatMessage.findMany({
      where: delta ? { createdAt: { gte: sinceDate! } } : {},
      orderBy: { createdAt: delta ? "asc" : "desc" },
      take: CHAT_PAGE,
      select,
    });
    const messages = delta ? raw : raw.reverse();

    const people = await chatNames();
    const names = people.map((u) => u.name);
    const byName = new Map(people.map((u) => [u.name.toLowerCase(), u]));

    return NextResponse.json({
      messages: messages.map((m) => ({
        id: m.id,
        authorName: m.authorName,
        authorId: m.userId,
        text: m.text,
        createdAt: m.createdAt,
        editedAt: m.editedAt,
        replyTo: m.replyTo,
        authorColor: m.user?.nameColor ?? DEFAULT_CHAT_COLOR,
        muted: m.user?.isMuted ?? false,
        mentions: findMentionedNames(m.text, names).map((n) => {
          const u = byName.get(n.toLowerCase());
          return { id: u?.id ?? null, name: n };
        }),
      })),
    });
  } catch {
    return NextResponse.json({
      messages: [
        {
          id: "1",
          authorName: "Royal Herald",
          authorId: null,
          text: "Welcome to Stone Quiz! (Local offline mode — live DB not configured)",
          createdAt: new Date().toISOString(),
          editedAt: null,
          replyTo: null,
          authorColor: DEFAULT_CHAT_COLOR,
          muted: false,
          mentions: [],
        },
      ],
    });
  }
}

export async function POST(req: Request) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => null);
  const text = typeof body?.text === "string" ? normalizeMessage(body.text) : "";
  if (!text) {
    return NextResponse.json({ error: "Mesajul nu poate fi gol." }, { status: 400 });
  }

  const ip = getClientIp(req);
  const ipRule = await getIpRule(ip);
  if (ipRule?.isBanned) {
    return NextResponse.json({ error: "Accesul de pe această adresă IP a fost blocat." }, { status: 403 });
  }
  if (ipRule?.isMuted) {
    return NextResponse.json({ error: "Această adresă IP este mutată. Nu poți trimite mesaje." }, { status: 403 });
  }

  const spam = checkChatSpam(session.sub, ip, text);
  if (!spam.ok && "error" in spam) {
    return NextResponse.json({ error: spam.error }, { status: spam.status });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: session.sub },
      select: { displayName: true, isMuted: true, lastIp: true },
    });
    if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    if (user.isMuted) {
      return NextResponse.json({ error: "Ești mutat. Nu poți trimite mesaje." }, { status: 403 });
    }
    if (ip !== "unknown" && user.lastIp !== ip) {
      await touchUserIp(session.sub, ip);
    }
    const replyToId = typeof body?.replyToId === "string" && body.replyToId ? body.replyToId : null;
    if (replyToId) {
      const parent = await prisma.chatMessage.findUnique({ where: { id: replyToId }, select: { id: true } });
      if (!parent) return NextResponse.json({ error: "Mesajul la care răspunzi nu mai există." }, { status: 400 });
    }
    const msg = await prisma.chatMessage.create({
      data: {
        userId: session.sub,
        authorName: user.displayName,
        text: text.slice(0, 2000),
        replyToId,
      },
      select: { id: true, authorName: true, text: true, createdAt: true },
    });
    return NextResponse.json({ message: msg });
  } catch {
    return NextResponse.json({
      message: {
        id: Math.random().toString(),
        authorName: session.name,
        text: text.slice(0, 2000),
        createdAt: new Date().toISOString(),
      },
    });
  }
}
