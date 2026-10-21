// Renders text without collapsing ASCII art: JSX eats runs of spaces and all
// newlines, which squashes pasted art into one line. Art (a newline or 2+ spaces)
// is shown in a <pre>; normal text keeps the caller's styling.
export function artPreview(text: string): string {
  if (!/\n/.test(text) && !/ {2,}/.test(text)) return text;
  const first = text.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  return `[art] ${first.slice(0, 40)}`;
}

export default function PromptText({
  text,
  className = "",
  wrap = false,
}: {
  text: string;
  className?: string;
  /** chat bubbles: keep the spacing but let long lines wrap instead of scrolling */
  wrap?: boolean;
}) {
  const art = /\n/.test(text) || / {2,}/.test(text);
  if (!art) return <span className={className}>{text}</span>;
  const shape = wrap
    ? "whitespace-pre-wrap break-words"
    : "whitespace-pre overflow-x-auto";
  return <pre className={`${shape} font-mono text-[0.78em] leading-[1.2] ${className}`}>{text}</pre>;
}