// Signed-session helpers. Edge-safe (Web Crypto only — works in proxy.ts and route handlers).
const SECRET = process.env.SESSION_SECRET || "dev-secret-change-me";
export const SESSION_COOKIE = "cq_session";

export interface SessionPayload {
  sub: string;
  name: string;
  exp: number; // unix seconds
}

function bytesToB64url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 ? "=".repeat(4 - (b64.length % 4)) : "";
  const bin = atob(b64 + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function hmac(data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data)));
}

export async function signSession(payload: SessionPayload): Promise<string> {
  const body = bytesToB64url(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = bytesToB64url(await hmac(body));
  return `${body}.${sig}`;
}

export async function verifySession(token: string | undefined | null): Promise<SessionPayload | null> {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const expected = await hmac(body);
  const given = b64urlToBytes(sig);
  if (expected.length !== given.length) return null;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected[i] ^ given[i];
  if (diff !== 0) return null;
  try {
    const p = JSON.parse(new TextDecoder().decode(b64urlToBytes(body))) as SessionPayload;
    if (!p.sub || !p.name || typeof p.exp !== "number" || p.exp < Date.now() / 1000) return null;
    return p;
  } catch {
    return null;
  }
}

export function sessionCookie(token: string, maxAgeDays = 30): string {
  const secure = process.env.NODE_ENV === "production";
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeDays * 86400}${secure ? "; Secure" : ""}`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}
