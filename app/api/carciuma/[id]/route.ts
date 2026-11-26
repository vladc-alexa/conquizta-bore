import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession, SESSION_COOKIE } from "@/lib/session";
import { buildCarciumaState, resolveCarciuma } from "@/lib/carciuma";

// GET /api/carciuma/[id] -> the whole table. Settles any round whose window has
// closed before answering, so polling alone keeps the game moving.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  await resolveCarciuma(id);
  const state = await buildCarciumaState(id, session.sub);
  if (!state) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(state, { headers: { "Cache-Control": "no-store" } });
}
