import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession, SESSION_COOKIE } from "@/lib/session";
import { buildDuelState, resolveDuel } from "@/lib/duel";

// GET /api/duel/[id] -> full public match state for the caller.
// Also the tick that lazily resolves finished rounds.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  await resolveDuel(id);

  const state = await buildDuelState(id, session.sub);
  if (!state) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!state.role) return NextResponse.json({ error: "not a participant" }, { status: 403 });
  return NextResponse.json(state);
}
