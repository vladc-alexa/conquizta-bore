// The ST0NE QUIZ wordmark: "ST" + faceted gem standing in for the O + "NE",
// with QUIZ tracked out underneath. Drawn as SVG + CSS so it stays crisp at any
// size and picks up the theme colours (see .brand in globals.css).

type Props = {
  /** wordmark height in px for the ST0NE line — QUIZ scales with it */
  size?: number;
  /** hide the QUIZ line when space is tight (e.g. inline page headers) */
  tagline?: boolean;
  className?: string;
};

export function Gem({ className = "" }: { className?: string }) {
  return (
    <svg
      className={`brand-gem ${className}`}
      viewBox="0 0 40 56"
      role="img"
      aria-label="o"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="gemBody" x1="0" y1="0" x2="0.35" y2="1">
          <stop offset="0%" stopColor="#b6d6d2" />
          <stop offset="38%" stopColor="#8fb3b0" />
          <stop offset="100%" stopColor="#4d716f" />
        </linearGradient>
      </defs>
      {/* outer crystal */}
      <path
        d="M20 2 L35 12.5 L35 38 L20 54 L5 38 L5 12.5 Z"
        fill="url(#gemBody)"
        stroke="#d7e6e3"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
      {/* girdle + pavilion facets */}
      <path d="M5 20 L35 20" stroke="#e8f4f2" strokeWidth="0.9" opacity="0.75" />
      <path d="M5 20 L20 54 L35 20" fill="none" stroke="#e8f4f2" strokeWidth="0.7" opacity="0.5" />
      <path d="M20 2 L20 20" stroke="#e8f4f2" strokeWidth="0.7" opacity="0.55" />
      <path d="M12.5 8 L12.5 20 M27.5 8 L27.5 20" stroke="#e8f4f2" strokeWidth="0.6" opacity="0.35" />
    </svg>
  );
}

export default function Brand({ size = 28, tagline = true, className = "" }: Props) {
  return (
    <span className={`brand ${className}`} style={{ fontSize: `${size}px` }}>
      <span className="brand-word">
        ST
        <Gem />
        NE
      </span>
      {tagline && <span className="brand-quiz">QUIZ</span>}
    </span>
  );
}
