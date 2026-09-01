import { NextResponse } from "next/server";
import { clearSessionCookie } from "@/lib/session";

export async function POST() {
  return new NextResponse(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json", "Set-Cookie": clearSessionCookie() },
  });
}
