// Global top bar: the ST0NE QUIZ wordmark, always visible, always a way home.
// Rendered once in the root layout so every page (dashboard, train, duel,
// leaderboard, login, admin…) carries the same clickable logo.
import Link from "next/link";
import Brand from "./Brand";

export default function SiteHeader() {
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
