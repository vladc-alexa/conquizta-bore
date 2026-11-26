import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession, SESSION_COOKIE } from "@/lib/session";
import { buildTowerState, resolveTower } from "@/lib/tower";

// GET /api/tower/[id] -> resolved game state for the viewer
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  await resolveTower(id);
  const state = await buildTowerState(id, session.sub);
  if (!state) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(state);
}
