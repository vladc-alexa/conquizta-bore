interface SpamTrack {
  timestamps: number[];
  lastText: string;
  lastTextAt: number;
  strikes: number[];
  cooldownUntil: number;
}

const g = globalThis as unknown as { __stoneChatSpam?: Map<string, SpamTrack> };
const tracks = (g.__stoneChatSpam ??= new Map<string, SpamTrack>());

const SHORT_WINDOW_MS = 10_000;
const SHORT_MAX = 5;
const LONG_WINDOW_MS = 60_000;
const LONG_MAX = 14;
const MIN_GAP_MS = 1_200;
const DUPLICATE_WINDOW_MS = 25_000;
const AUTO_COOLDOWN_MS = 20_000;

function getTrack(key: string): SpamTrack {
  let t = tracks.get(key);
  if (!t) {
    t = { timestamps: [], lastText: "", lastTextAt: 0, strikes: [], cooldownUntil: 0 };
    tracks.set(key, t);
  }
  return t;
}

function pruneMap(now: number) {
  if (tracks.size <= 2000) return;
  for (const [k, v] of tracks) {
    const latest = v.timestamps[v.timestamps.length - 1] ?? 0;
    if (now - latest > LONG_WINDOW_MS * 2 && now > v.cooldownUntil) {
      tracks.delete(k);
    }
  }
}

function hasFloodPattern(text: string): boolean {
  // 15+ identical characters in a row (e.g. aaaaaaaaaaaaaaaa)
  if (/(.)\1{14,}/u.test(text)) return true;
  // Short 2-6 char chunk repeated 10+ times consecutively (e.g. pulapulapula...)
  if (/(.{2,6})\1{9,}/iu.test(text)) return true;
  return false;
}

export function checkChatSpam(
  userId: string,
  ip: string,
  text: string
): { ok: true } | { ok: false; status: number; error: string } {
  const now = Date.now();
  pruneMap(now);

  if (hasFloodPattern(text)) {
    return {
      ok: false,
      status: 400,
      error: "Mesajul conține prea multe caractere sau cuvinte repetate (anti-spam).",
    };
  }

  const normalized = text.trim().toLowerCase().replace(/\s+/g, " ");
  const keys = [`u:${userId}`];
  if (ip && ip !== "unknown") keys.push(`ip:${ip}`);

  for (const key of keys) {
    const tr = getTrack(key);

    if (now < tr.cooldownUntil) {
      const secs = Math.max(1, Math.ceil((tr.cooldownUntil - now) / 1000));
      return {
        ok: false,
        status: 429,
        error: `Prea multe mesaje (anti-spam). Încearcă peste ${secs}s.`,
      };
    }

    if (tr.lastText && tr.lastText === normalized && now - tr.lastTextAt < DUPLICATE_WINDOW_MS) {
      return {
        ok: false,
        status: 400,
        error: "Nu trimite același mesaj de mai multe ori la rând.",
      };
    }

    tr.timestamps = tr.timestamps.filter((ts) => now - ts < LONG_WINDOW_MS);
    const lastTs = tr.timestamps[tr.timestamps.length - 1] ?? 0;
    const recent10s = tr.timestamps.filter((ts) => now - ts < SHORT_WINDOW_MS);

    if (now - lastTs < MIN_GAP_MS || recent10s.length >= SHORT_MAX || tr.timestamps.length >= LONG_MAX) {
      tr.strikes = tr.strikes.filter((s) => now - s < 30_000);
      tr.strikes.push(now);
      if (tr.strikes.length >= 4) {
        tr.cooldownUntil = now + AUTO_COOLDOWN_MS;
        tr.strikes = [];
        return {
          ok: false,
          status: 429,
          error: "Spam detectat. Chat-ul este blocat 20 de secunde.",
        };
      }
      return {
        ok: false,
        status: 429,
        error: "Trimiți mesaje prea repede. Așteaptă puțin.",
      };
    }
  }

  // Record accepted message across all keys
  for (const key of keys) {
    const tr = getTrack(key);
    tr.timestamps.push(now);
    tr.lastText = normalized;
    tr.lastTextAt = now;
  }

  return { ok: true };
}
