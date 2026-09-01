import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifySession, SESSION_COOKIE } from "./lib/session";

const PROTECTED_PREFIXES = ["/train"];

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);

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
  matcher: ["/", "/login", "/train/:path*"],
};
