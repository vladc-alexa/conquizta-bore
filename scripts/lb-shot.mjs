// Screenshot harness for the clasament points/rating toggle (throwaway DB).
// Usage: PORT=3214 DATABASE_URL=... node scripts/lb-shot.mjs
import { spawn } from "node:child_process";
import { existsSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";

const BASE = `http://127.0.0.1:${process.env.PORT || 3214}`;
const OUT = "/tmp/lbshots";
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findChrome() {
  const root = `${process.env.HOME}/.cache/ms-playwright`;
  const dirs = existsSync(root) ? readdirSync(root).filter((d) => d.startsWith("chromium-")) : [];
  for (const d of dirs) if (existsSync(`${root}/${d}/chrome-linux64/chrome`)) return `${root}/${d}/chrome-linux64/chrome`;
  return null;
}

async function cdpSession(url) {
  const ws = new WebSocket(url);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const i = ++id;
      pending.set(i, (m) => (m.error ? rej(new Error(`${method}: ${JSON.stringify(m.error)}`)) : res(m.result)));
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  return { send, close: () => ws.close() };
}

const r = await fetch(`${BASE}/api/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: "blitzer@example.test", password: "e2e-pass-123" }),
});
const raw = r.headers.get("set-cookie") || "";
const [pair] = raw.split(";");
const [cname, cval] = pair.split("=");
console.log("login", r.status, cname);

const chromePath = findChrome();
if (!chromePath) throw new Error("no cached chromium");
const proc = spawn(chromePath, [
  "--headless=new", "--remote-debugging-port=9321", "--no-sandbox", "--disable-gpu",
  "--hide-scrollbars", "--window-size=1280,900", `--user-data-dir=/tmp/chrome-lb-${Date.now()}`, "about:blank",
], { stdio: "ignore" });

let targets = null;
for (let i = 0; i < 40; i++) {
  try { targets = await (await fetch("http://127.0.0.1:9321/json/list")).json(); if (targets?.length) break; } catch {}
  await sleep(250);
}
const page = targets.find((t) => t.type === "page");
const cdp = await cdpSession(page.webSocketDebuggerUrl);
await cdp.send("Page.enable");
await cdp.send("Network.enable");
await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
await cdp.send("Network.setCookie", { name: cname, value: cval, domain: "127.0.0.1", path: "/" });

const evalJs = async (expression) => (await cdp.send("Runtime.evaluate", { expression, returnByValue: true })).result.value;
const shot = async (label) => {
  const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
  const f = `${OUT}/lb-${label}.png`;
  writeFileSync(f, Buffer.from(data, "base64"));
  return f;
};

await cdp.send("Page.navigate", { url: `${BASE}/leaderboard` });
await sleep(3500);
console.log("all-time click:", await evalJs(`(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Tot timpul'); if(!b) return 'no-button'; b.click(); return 'clicked'; })()`));
await sleep(2500);
console.log("points view:", await evalJs(`document.body.innerText.replace(/\\n+/g,' | ').slice(0,400)`));
console.log(await shot("points"));

const clicked = await evalJs(`(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Rating'); if(!b) return 'no-button'; b.click(); return 'clicked'; })()`);
console.log("toggle:", clicked);
await sleep(2500);
console.log("rating view:", await evalJs(`document.body.innerText.replace(/\\n+/g,' | ').slice(0,400)`));
console.log(await shot("rating"));

// phone width check
await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await sleep(1200);
console.log(await shot("rating-mobile"));

cdp.close();
proc.kill();
