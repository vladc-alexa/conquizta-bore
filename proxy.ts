import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifySession, SESSION_COOKIE } from "./lib/session";
import { prisma } from "./lib/prisma";
import { isSiteOff } from "./lib/siteOff";

const PROTECTED_PREFIXES = ["/train", "/duel", "/admin"];

// Themed "site off" page served to non-admins while maintenance mode is on.
// No buttons, no links — the only way in is the secret /admin/login path.
const GEM_SVG = `<svg viewBox="0 0 40 56" height="46" style="vertical-align:-9px;margin:0 2px" xmlns="http://www.w3.org/2000/svg">
<path d="M20 2 L35 12.5 L35 38 L20 54 L5 38 L5 12.5 Z" fill="#7fa8a5" stroke="#d7e6e3" stroke-width="1.1" stroke-linejoin="round"/>
<path d="M5 20 L35 20" stroke="#e8f4f2" stroke-width="0.9" opacity="0.75"/>
<path d="M5 20 L20 54 L35 20" fill="none" stroke="#e8f4f2" stroke-width="0.7" opacity="0.5"/>
<path d="M20 2 L20 20" stroke="#e8f4f2" stroke-width="0.7" opacity="0.55"/></svg>`;

const OFF_HTML = `<!doctype html><html lang="ro"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ST0NE QUIZ — Site oprit</title></head>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:radial-gradient(ellipse at top,#0b1a16 0%,#040a08 100%);color:#b9d3d0;font-family:'Jost',Futura,'Century Gothic',sans-serif;text-align:center">
<div><div style="font-size:64px;line-height:1">⏻</div>
<div style="color:#dfe7e5;font-weight:300;font-size:38px;letter-spacing:8px;margin:18px 0 6px">ST${GEM_SVG}NE</div>
<div style="color:#cfe0de;font-weight:300;font-size:15px;letter-spacing:12px;margin:0 0 22px;padding-left:12px">QUIZ</div>
<p style="color:#8fb0ac;font-size:15px;margin:0">Site-ul este oprit temporar.</p>
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
  matcher: ["/", "/login", "/train/:path*", "/duel/:path*", "/admin", "/admin/login", "/api/:path*"],
};
