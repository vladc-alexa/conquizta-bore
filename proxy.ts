import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifySession, SESSION_COOKIE } from "./lib/session";
import { prisma } from "./lib/prisma";
import { isSiteOff } from "./lib/siteOff";

const PROTECTED_PREFIXES = ["/train", "/admin"];

// Themed "site off" page served to non-admins while maintenance mode is on.
// No buttons, no links — the only way in is the secret /admin/login path.
const OFF_HTML = `<!doctype html><html lang="ro"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MAHALADOR — Site oprit</title></head>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:radial-gradient(ellipse at top,#3b2a1a 0%,#1a0e05 100%);color:#f0e0c0;font-family:Georgia,'Times New Roman',serif;text-align:center">
<div><div style="font-size:64px;line-height:1">⏻</div>
<h1 style="color:#f5c97a;letter-spacing:3px;margin:18px 0 8px">MAHALADOR</h1>
<p style="color:#c8a070;font-size:15px;margin:0">Site-ul este oprit temporar.</p>
</div></body></html>`;

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);

  // ---- maintenance mode: only admins see the site ----
  if (await isSiteOff(prisma)) {
    if (session) {
      const user = await prisma.user.findUnique({ where: { id: session.sub }, select: { isAdmin: true } });
      if (user?.isAdmin) return NextResponse.next(); // admin passes everywhere
    }
    // non-admin: the secret /admin/login path is the only way in
    if (pathname === "/admin/login" || pathname === "/api/auth/login" || pathname === "/api/auth/logout") {
      return NextResponse.next();
    }
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Site oprit." }, { status: 503 });
    }
    return new NextResponse(OFF_HTML, {
      status: 503,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  // /admin/login is only meaningful while the site is off — otherwise send
  // visitors to the regular login/dashboard.
  if (pathname === "/admin/login") {
    const url = req.nextUrl.clone();
    url.pathname = session ? "/" : "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // ---- normal auth logic ----
  const needsAuth = pathname === "/" || PROTECTED_PREFIXES.some((p) => pathname.startsWith(p));

  if (needsAuth && !session) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  if (pathname === "/login" && session) {
    const url = req.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/login", "/train/:path*", "/admin", "/admin/login", "/api/:path*"],
};
