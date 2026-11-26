#!/usr/bin/env node
/**
 * End-to-end proof of the email-required registration flow.
 *
 *   DATABASE_URL=postgresql://postgres:e2e@127.0.0.1:55433/postgres \
 *   node scripts/auth-email-e2e.mjs
 *
 * Boots a throwaway SMTP sink on 127.0.0.1:2525, starts the built app
 * (`npm run build` first) on :3107 pointed at that sink, then drives:
 * register → mail → unverified login refused → verify → logged in,
 * plus resend, forgot-password and reset-password.
 */
import net from "node:net";
import { spawn } from "node:child_process";

const PORT = Number(process.env.E2E_PORT || 3107);
const BASE = `http://127.0.0.1:${PORT}`;
const SMTP_PORT = 2525;
const mails = [];

function decodeQP(s) {
  return s.replace(/=\r?\n/g, "").replace(/=3D/g, "=");
}

function bodyOf(raw) {
  const idx = raw.indexOf("\r\n\r\n");
  return decodeQP(idx >= 0 ? raw.slice(idx + 4) : raw);
}

const smtp = net.createServer((sock) => {
  let buf = "";
  let inData = false;
  let data = "";
  sock.write("220 e2e-sink ESMTP\r\n");
  sock.on("data", (chunk) => {
    buf += chunk.toString("utf8");
    if (inData) {
      data += buf;
      buf = "";
      const end = data.indexOf("\r\n.\r\n");
      if (end >= 0) {
        const raw = data.slice(0, end);
        mails.push(raw);
        data = "";
        inData = false;
        sock.write("250 2.0.0 Ok: queued\r\n");
      }
      return;
    }
    let nl;
    while ((nl = buf.indexOf("\r\n")) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 2);
      const cmd = line.slice(0, 4).toUpperCase();
      if (cmd === "EHLO" || cmd === "HELO") {
        sock.write("250-e2e-sink\r\n250-8BITMIME\r\n250 SIZE 52428800\r\n");
      } else if (cmd === "MAIL" || cmd === "RCPT" || cmd === "RSET" || cmd === "NOOP") {
        sock.write("250 2.1.0 Ok\r\n");
      } else if (cmd === "DATA") {
        inData = true;
        sock.write("354 End data with <CR><LF>.<CR><LF>\r\n");
      } else if (cmd === "QUIT") {
        sock.write("221 Bye\r\n");
        sock.end();
      } else {
        sock.write("250 Ok\r\n");
      }
    }
  });
  sock.on("error", () => {});
});

const results = [];
function check(name, cond, extra = "") {
  results.push({ name, ok: Boolean(cond), extra });
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? `  — ${extra}` : ""}`);
}

async function waitForServer(timeoutMs = 90_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(`${BASE}/login`);
      if (r.status === 200) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("server did not come up");
}

function lastMailTo(addr) {
  for (let i = mails.length - 1; i >= 0; i--) {
    if (mails[i].toLowerCase().includes(addr.toLowerCase())) return mails[i];
  }
  return "";
}

function linkToken(raw, kind) {
  const m = bodyOf(raw).match(new RegExp(`/${kind}\\?token=([A-Za-z0-9_-]{20,})`));
  return m ? m[1] : "";
}

async function post(path, body, cookie) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json, cookie: res.headers.get("set-cookie")?.split(";")[0] };
}

const email = `e2e${Date.now()}@stonequiz.test`;
const name = `e2e${Math.floor(Math.random() * 1e6)}`;
const password = "parola123";

await new Promise((r) => smtp.listen(SMTP_PORT, "127.0.0.1", r));
console.log(`SMTP sink on :${SMTP_PORT}`);

const server = spawn("npx", ["next", "start", "-p", String(PORT)], {
  env: {
    ...process.env,
    NODE_ENV: "production",
    SESSION_SECRET: "e2e-secret",
    APP_BASE_URL: BASE,
    SMTP_HOST: "127.0.0.1",
    SMTP_PORT: String(SMTP_PORT),
    SMTP_USER: "",
    SMTP_PASSWORD: "",
    MAIL_FROM: "ST0NE QUIZ <e2e@stonequiz.test>",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stdout.on("data", () => {});
server.stderr.on("data", (d) => process.stderr.write(`[next] ${d}`));

try {
  await waitForServer();
  console.log("server up");

  // 1. garbage email is rejected
  const bad = await post("/api/auth/register", { displayName: name + "x", email: "not-an-email", password });
  check("register rejects invalid email", bad.status === 400, `status ${bad.status}`);

  // 2. valid signup → 201, no session, mail sent
  const reg = await post("/api/auth/register", { displayName: name, email, password });
  check("register returns 201 + requiresVerification", reg.status === 201 && reg.json.requiresVerification === true, `status ${reg.status}`);
  check("register does NOT hand out a session cookie", !reg.cookie, reg.cookie ? "cookie set" : "no cookie");

  let mail = lastMailTo(email);
  check("confirmation email delivered to the mailbox", Boolean(mail));
  const verifyToken = linkToken(mail, "verify-email");
  check("confirmation email carries a verify link", Boolean(verifyToken));
  check("email comes from the configured sender", /ST0NE QUIZ <e2e@stonequiz\.test>/i.test(mail));

  // 3. login refused while unverified
  const login1 = await post("/api/auth/login", { email, password });
  check("login before confirmation is refused with EMAIL_UNVERIFIED", login1.status === 403 && login1.json.code === "EMAIL_UNVERIFIED", `status ${login1.status} code ${login1.json.code}`);

  // 4. duplicate signup with the same address is refused
  const dup = await post("/api/auth/register", { displayName: name + "y", email, password });
  check("duplicate email refused for a second account", dup.status === 409, `status ${dup.status}`);

  // 5. resend works and mints a new link
  const resend = await post("/api/auth/resend-verification", { email });
  check("resend answers 200", resend.status === 200);
  await new Promise((r) => setTimeout(r, 300));
  const resentMail = lastMailTo(email);
  const resentToken = linkToken(resentMail, "verify-email");
  check("resend sends another confirmation link", Boolean(resentToken) && resentMail !== mail);

  // 6. clicking the link verifies + signs in
  const verify = await post("/api/auth/verify-email", { token: resentToken });
  check("verify-email returns 200 with a session cookie", verify.status === 200 && Boolean(verify.cookie), `status ${verify.status}`);
  const me = await fetch(`${BASE}/api/auth/me`, { headers: { Cookie: verify.cookie } });
  const meJson = await me.json().catch(() => ({}));
  check("/api/auth/me accepts the new session", me.status === 200 && Boolean(meJson.name), `status ${me.status}`);

  // 7. token is single-use
  const reuse = await post("/api/auth/verify-email", { token: resentToken });
  check("verification link cannot be reused", reuse.status === 400, `status ${reuse.status}`);

  // 8. login now succeeds
  const login2 = await post("/api/auth/login", { email, password });
  check("login after confirmation succeeds", login2.status === 200 && Boolean(login2.cookie), `status ${login2.status}`);

  // 9. forgot-password mails a reset link
  const forgot = await post("/api/auth/forgot-password", { email });
  check("forgot-password answers 200", forgot.status === 200);
  await new Promise((r) => setTimeout(r, 300));
  const resetToken = linkToken(lastMailTo(email), "reset-password");
  check("reset email carries a reset link", Boolean(resetToken));

  const unknown = await post("/api/auth/forgot-password", { email: "nobody@stonequiz.test" });
  check("forgot-password does not leak unknown addresses", unknown.status === 200 && unknown.json.ok === true);

  // 10. reset sets a new password (and logs in), old password dies
  const reset = await post("/api/auth/reset-password", { token: resetToken, password: "parolanoua1" });
  check("reset-password returns 200 + session", reset.status === 200 && Boolean(reset.cookie), `status ${reset.status}`);
  const oldPw = await post("/api/auth/login", { email, password });
  check("old password no longer works", oldPw.status === 401, `status ${oldPw.status}`);
  const newPw = await post("/api/auth/login", { email, password: "parolanoua1" });
  check("new password works", newPw.status === 200 && Boolean(newPw.cookie), `status ${newPw.status}`);

  const resetReuse = await post("/api/auth/reset-password", { token: resetToken, password: "altaparola" });
  check("reset link cannot be reused", resetReuse.status === 400, `status ${resetReuse.status}`);

  // 11. pages render
  for (const p of ["/verify-email", "/forgot-password", "/reset-password", "/register"]) {
    const r = await fetch(`${BASE}${p}`);
    check(`page ${p} renders`, r.status === 200, `status ${r.status}`);
  }
} catch (e) {
  check("harness ran to completion", false, e.message);
} finally {
  server.kill("SIGTERM");
  smtp.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
