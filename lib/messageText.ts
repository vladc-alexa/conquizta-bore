// Chat message cleanup. Plain .trim() eats the leading spaces of the *first*
// line only, which shifts the top row of pasted ASCII art to the left while the
// rest stays put. Strip blank lines at the edges + trailing blanks per line, but
// never the indentation of a line that has content.
export function normalizeMessage(raw: string): string {
  const lines = String(raw ?? "").replace(/\r\n?/g, "\n").split("\n");
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  return lines.map((l) => l.replace(/[ \t]+$/, "")).join("\n");
}
