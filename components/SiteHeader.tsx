"use client";

// Global top bar: the ST0NE QUIZ wordmark, always visible, always a way home.
// Rendered once in the root layout so every page (leaderboard, login, admin…)
// carries the same clickable logo.
//
// Two exceptions:
//  • "/" renders the wordmark itself, inline with the nav buttons, so the
//    dashboard fits one screen without a scrollbar.
//  • Games (train, a carciuma table, a tower, a duel) drop the logo entirely —
//    every pixel goes to the board.
import Link from "next/link";
import { usePathname } from "next/navigation";
import Brand from "./Brand";

/** routes that are a game in progress — no wordmark, no wasted row */
const GAME = [/^\/train\/?$/, /^\/carciuma\/[^/]+/, /^\/tower\/[^/]+/, /^\/duel\/[^/]+/];

export default function SiteHeader() {
  const pathname = usePathname() || "/";
  if (pathname === "/" || GAME.some((re) => re.test(pathname))) return null;

  return (
    <header className="w-full max-w-6xl mx-auto shrink-0">
      <Link
        href="/"
        aria-label="ST0NE QUIZ — pagina principală"
        title="Pagina principală"
        className="inline-flex items-center py-2 hover:brightness-125 transition-[filter]"
      >
        {/* deliberately large: the wordmark is the page's identity, not a nav icon */}
        <Brand size={44} />
      </Link>
    </header>
  );
}
