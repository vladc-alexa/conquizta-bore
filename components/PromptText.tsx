// Renders text without collapsing ASCII art: JSX eats runs of spaces and all
// newlines, which squashes pasted art into one line. Art (a newline or 2+ spaces)
// is shown in a <pre>; normal text keeps the caller's styling.
export function artPreview(text: string): string {
  if (!/\n/.test(text) && !/ {2,}/.test(text)) return text;
  const first = text.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  return `[art] ${first.slice(0, 40)}`;
}

export default function PromptText({ text, className = "" }: { text: string; className?: string }) {
  const art = /\n/.test(text) || / {2,}/.test(text);
  if (!art) return <span className={className}>{text}</span>;
  return (
    <pre className={`whitespace-pre overflow-x-auto font-mono text-[0.78em] leading-[1.2] ${className}`}>
      {text}
    </pre>
  );
}