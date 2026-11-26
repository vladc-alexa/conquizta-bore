// Chat body with "@Name" runs highlighted. Falls back to PromptText for text
// without mentions, so pasted ASCII art keeps its spacing exactly as before.
import PromptText, { isArt } from "@/components/PromptText";
import { splitMentions } from "@/lib/mentions";

export default function ChatText({
  text,
  names,
  className = "",
}: {
  text: string;
  names: string[];
  className?: string;
}) {
  const pieces = splitMentions(text, names);
  if (pieces.length === 1 && !pieces[0].mention) {
    return <PromptText text={text} wrap className={className} />;
  }
  const art = isArt(text);
  return (
    <span
      className={`${art ? "whitespace-pre-wrap break-words font-mono text-[0.78em] leading-[1.2]" : ""} ${className}`}
    >
      {pieces.map((p, i) =>
        p.mention ? (
          <span
            key={i}
            className="rounded bg-[#3a2d12] px-[3px] font-semibold text-[#ffd98e] [text-shadow:0_0_8px_rgba(255,217,142,0.35)]"
          >
            {p.text}
          </span>
        ) : (
          <span key={i}>{p.text}</span>
        )
      )}
    </span>
  );
}
