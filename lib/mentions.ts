// @-mentions in the general chat. One tiny parser shared by the API (which
// annotates every feed message with who it pings) and the client (which
// highlights them and offers the @-autocomplete while typing).
//
// Rules:
//  - "@" must start a token (no "@" inside "foo@bar", so e-mail addresses and
//    ASCII art eyes never turn into pings);
//  - the name must match a real display name, longest first ("@Ion Popescu"
//    wins over a player called "@Ion");
//  - the match must end on a boundary (not mid-word), case-insensitive.

const WORD = /[\p{L}\p{N}_]/u;

export type MentionPiece = { text: string; mention: boolean };

/** Names mentioned in `text`, canonical spelling, in order, no duplicates. */
export function findMentionedNames(text: string, names: string[]): string[] {
  if (!text || !names.length) return [];
  const sorted = [...new Set(names.filter(Boolean))].sort((a, b) => b.length - a.length);
  const lower = text.toLowerCase();
  const out: string[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "@") continue;
    if (i > 0 && WORD.test(text[i - 1])) continue;
    for (const name of sorted) {
      const n = name.toLowerCase();
      if (!lower.startsWith(n, i + 1)) continue;
      const after = lower[i + 1 + n.length];
      if (after && WORD.test(after)) continue;
      if (!out.includes(name)) out.push(name);
      i += n.length;
      break;
    }
  }
  return out;
}

/** Split a message into plain runs and "@Name" runs, for rendering. */
export function splitMentions(text: string, names: string[]): MentionPiece[] {
  const hits = findMentionedNames(text, names);
  if (!hits.length) return [{ text, mention: false }];
  const sorted = hits.sort((a, b) => b.length - a.length);
  const lower = text.toLowerCase();
  const pieces: MentionPiece[] = [];
  let plain = "";
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "@" && (i === 0 || !WORD.test(text[i - 1]))) {
      const hit = sorted.find((name) => {
        const n = name.toLowerCase();
        if (!lower.startsWith(n, i + 1)) return false;
        const after = lower[i + 1 + n.length];
        return !after || !WORD.test(after);
      });
      if (hit) {
        if (plain) pieces.push({ text: plain, mention: false });
        plain = "";
        pieces.push({ text: text.slice(i, i + 1 + hit.length), mention: true });
        i += hit.length;
        continue;
      }
    }
    plain += text[i];
  }
  if (plain) pieces.push({ text: plain, mention: false });
  return pieces;
}

export type MentionQuery = { start: number; query: string };

/**
 * Is the caret sitting inside an unfinished "@..." token? Returns where the "@"
 * is and what has been typed after it (used to drive the autocomplete).
 */
export function mentionQueryAt(text: string, caret: number): MentionQuery | null {
  const before = text.slice(0, Math.max(0, caret));
  const at = before.lastIndexOf("@");
  if (at < 0) return null;
  if (at > 0 && WORD.test(before[at - 1])) return null; // e-mail, not a ping
  const query = before.slice(at + 1);
  if (query.includes("\n") || query.length > 32) return null;
  return { start: at, query };
}
