"use client";

// The round poker table: walnut rim, green felt, brass cup holders. Drawn in SVG
// so it stays crisp at any size and matches the painted tavern around it.
export default function CarciumaTable({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 900 360" className={className} aria-hidden>
      <defs>
        <linearGradient id="cq-rim" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#c08a4e" />
          <stop offset="38%" stopColor="#96622f" />
          <stop offset="100%" stopColor="#4c2c14" />
        </linearGradient>
        <radialGradient id="cq-felt" cx="0.5" cy="0.38" r="0.75">
          <stop offset="0%" stopColor="#2b6b52" />
          <stop offset="55%" stopColor="#1c4c3a" />
          <stop offset="100%" stopColor="#123027" />
        </radialGradient>
        <linearGradient id="cq-shine" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
        <filter id="cq-soft" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="12" />
        </filter>
      </defs>

      {/* floor shadow */}
      <ellipse cx="450" cy="300" rx="360" ry="52" fill="#000" opacity="0.45" filter="url(#cq-soft)" />

      {/* wooden rim */}
      <ellipse cx="450" cy="200" rx="400" ry="150" fill="url(#cq-rim)" stroke="#2a1608" strokeWidth="6" />
      <ellipse cx="450" cy="192" rx="392" ry="142" fill="none" stroke="#e2b071" strokeOpacity="0.35" strokeWidth="3" />
      {/* grain on the rim */}
      <g stroke="#3d2310" strokeOpacity="0.35" strokeWidth="2" fill="none">
        <ellipse cx="450" cy="205" rx="372" ry="130" />
        <ellipse cx="450" cy="212" rx="348" ry="120" />
      </g>

      {/* felt */}
      <ellipse cx="450" cy="196" rx="336" ry="104" fill="url(#cq-felt)" stroke="#0d241c" strokeWidth="4" />
      <ellipse cx="450" cy="196" rx="318" ry="92" fill="none" stroke="#7fd3a8" strokeOpacity="0.18" strokeWidth="2" strokeDasharray="7 9" />
      <ellipse cx="450" cy="150" rx="250" ry="52" fill="url(#cq-shine)" />

      {/* brass cup holders set into the felt */}
      {[
        [450, 118],
        [236, 196],
        [664, 196],
        [450, 272],
      ].map(([cx, cy]) => (
        <g key={`${cx}-${cy}`}>
          <circle cx={cx} cy={cy} r="15" fill="#2a1608" opacity="0.55" />
          <circle cx={cx} cy={cy} r="13" fill="#a8813f" stroke="#5d431c" strokeWidth="2" />
          <circle cx={cx} cy={cy} r="9" fill="#3b2a12" />
        </g>
      ))}
    </svg>
  );
}
