// Visual proof harness for the duel arena: builds a fixture duel, drives it
// through the real API, and screenshots the arena at each beat with a headless
// Chromium over raw CDP (no playwright dependency -- only the cached browser in
// ~/.cache/ms-playwright is needed).
//
// Usage: PORT=3210 npm start &   then   node scripts/duel-shot.mjs
// Output: /tmp/shots/arena-*.png
import { PrismaClient } from "@prisma/client";
import { scryptSync, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync, readdirSync } from "node:fs";

const BASE = process.env.BASE || "http://127.0.0.1:3210";
const OUT = process.env.OUT || "/tmp/shots";
const TAG = "SHOTE2E";
const PW = "shot-pass-123";
const prisma = new PrismaClient();
mkdirSync(OUT, { recursive: true });

const hash = (p) => {
  const salt = randomBytes(16).toString("hex");
  return `scrypt$${salt}$${scryptSync(p, salt, 64).toString("hex")}`;
};
const CLASSES = ["knight", "soldier", "roman"];
const classFor = (id) => {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (Math.imul(h, 31) + id.charCodeAt(i)) >>> 0;
  return CLASSES[h % CLASSES.length];
};

async function login(name) {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: name, password: PW }),
  });
  if (!r.ok) throw new Error(`login ${name} -> ${r.status}`);
  const raw = r.headers.get("set-cookie") || "";
  const [pair] = raw.split(";");
  const [cname, cval] = pair.split("=");
  return { name, id: (await r.json().catch(() => ({}))).id, cookie: pair, cname, cval };
}
async function api(cookie, path, opts = {}) {
  const r = await fetch(BASE + path, { ...opts, headers: { "Content-Type": "application/json", Cookie: cookie, ...(opts.headers || {}) } });
  let body = null;
  try { body = await r.json(); } catch {}
  return { status: r.status, body };
}
const post = (c, p, b) => api(c, p, { method: "POST", body: b ? JSON.stringify(b) : undefined });

// ---- chromium over CDP -----------------------------------------------------
function findChrome() {
  const root = `${process.env.HOME}/.cache/ms-playwright`;
  const dirs = existsSync(root) ? readdirSync(root).filter((d) => d.startsWith("chromium-")) : [];
  for (const d of dirs) if (existsSync(`${root}/${d}/chrome-linux64/chrome`)) return `${root}/${d}/chrome-linux64/chrome`;
  return null;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

async function main() {
  await prisma.user.deleteMany({ where: { displayName: { startsWith: TAG } } });

  // find a pair: host must draw the soldier (the new pose set), guest a strip class
  let host = null, guest = null;
  for (let i = 0; i < 24 && (!host || !guest); i++) {
    const u = await prisma.user.create({ data: { displayName: `${TAG}-${i}`, passwordHash: hash(PW) } });
    const cls = classFor(u.id);
    if (!host && cls === "soldier") host = u;
    else if (host && !guest && cls !== "soldier") guest = u;
    else await prisma.user.delete({ where: { id: u.id } });
  }
  if (!host || !guest) throw new Error("could not find a soldier/strip user pair");
  console.log(`host ${host.displayName} = ${classFor(host.id)} · guest ${guest.displayName} = ${classFor(guest.id)}`);

  const A = await login(host.displayName);
  const B = await login(guest.displayName);
  const created = await post(A.cookie, "/api/duel");
  const id = created.body.duelId;
  await post(B.cookie, `/api/duel/${id}/join`);
  let st = (await api(A.cookie, `/api/duel/${id}`)).body;
  console.log(`duel ${id} · pushLimit ${st.pushLimit}`);

  const chromePath = findChrome();
  if (!chromePath) throw new Error("no cached chromium found");
  const proc = spawn(chromePath, [
    "--headless=new", "--remote-debugging-port=9222", "--no-sandbox", "--disable-gpu",
    "--hide-scrollbars", "--window-size=1600,1000", `--user-data-dir=/tmp/chrome-shot-${Date.now()}`, "about:blank",
  ], { stdio: "ignore" });

  let targets = null;
  for (let i = 0; i < 40; i++) {
    try { targets = await (await fetch("http://127.0.0.1:9222/json/list")).json(); if (targets?.length) break; } catch {}
    await sleep(250);
  }
  const page = targets.find((t) => t.type === "page");
  const cdp = await cdpSession(page.webSocketDebuggerUrl);
  await cdp.send("Page.enable");
  await cdp.send("Network.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 760, deviceScaleFactor: 1, mobile: false });
  await cdp.send("Network.setCookie", { name: A.cname, value: A.cval, domain: "127.0.0.1", path: "/" });

  const shot = async (label) => {
    const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
    const f = `${OUT}/arena-${label}.png`;
    writeFileSync(f, Buffer.from(data, "base64"));
    return f;
  };
  // which pose image is currently shown (pose classes only)
  const activePose = async () => {
    const r = await cdp.send("Runtime.evaluate", {
      expression: `JSON.stringify([...document.querySelectorAll('.dw-pose.dw-on')].map(p=>(p.style.backgroundImage.match(/\\/duel\\/([^"']+)/)||[])[1]||''))`,
      returnByValue: true,
    });
    return JSON.parse(r.result.value);
  };
  // wait for a specific pose to appear (the attack/victory window is only 700ms),
  // then screenshot it -- deterministic proof instead of a blind burst. `expect` is
  // the score line the arena must already be showing, otherwise we would shoot the
  // previous round again (the client polls once every 1.2s).
  const waitPose = async (label, re, expect, ms = 12000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const r = await cdp.send("Runtime.evaluate", {
        expression: `JSON.stringify({on:[...document.querySelectorAll('.dw-pose.dw-on')].map(p=>p.style.backgroundImage),label:document.querySelector('.dw-arena')?.getAttribute('aria-label')||''})`,
        returnByValue: true,
      });
      const { on, label: aria } = JSON.parse(r.result.value);
      const hit = on.find((p) => re.test(p));
      if (hit && aria.includes(expect)) {
        await sleep(170); // let the 90ms pose crossfade finish before capturing
        console.log(`      at shot: ${hit} | ${aria}`);
        return shot(`${label}-${hit.match(/([^/]+)\.webp/)[1]}`);
      }
      await sleep(80);
    }
    console.log(`   (pose ${re} never appeared for ${label} at "${expect}")`);
    return shot(`${label}-missed`);
  };

  await cdp.send("Page.navigate", { url: `${BASE}/duel/${id}` });
  await sleep(3500); // hydrate + first poll
  // zoom the page so the screenshots are readable (the arena is capped at ~620px)
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1000, deviceScaleFactor: 2, mobile: false });
  await cdp.send("Runtime.evaluate", { expression: "document.body.style.zoom='2.2'" });
  await sleep(600);
  console.log("idle:", await shot("idle"));
  const dom = await cdp.send("Runtime.evaluate", {
    expression: `JSON.stringify({arena:(r=>({x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}))(document.querySelector('.dw-arena').getBoundingClientRect()),fighters:[...document.querySelectorAll('.dw-fighter')].map(f=>{const r=f.getBoundingClientRect();const on=[...f.querySelectorAll('.dw-pose.dw-on')].map(p=>p.style.backgroundImage);return {left:r.left|0,w:r.width|0,h:r.height|0,on};})})`,
    returnByValue: true,
  });
  console.log("fighters:", dom.result.value);

  // play a round: A (host, soldier) wins -> burst to catch the clash poses
  const entryOf = async (round) => (await prisma.duel.findUnique({ where: { id } })).plan[round];
  const answer = (cookie, round, entry, correct) =>
    entry.mode === "grila"
      ? post(cookie, `/api/duel/${id}/answer`, { round, selectedOptionId: correct ? entry.correctOptionId : entry.options.find((o) => o.id !== entry.correctOptionId).id })
      : post(cookie, `/api/duel/${id}/answer`, { round, answer: String(correct ? entry.answer : entry.answer + 5000) });

  for (let guard = 0; guard < 8; guard++) {
    st = (await api(A.cookie, `/api/duel/${id}`)).body;
    if (st.status === "COMPLETED") break;
    const e = await entryOf(st.round);
    const last = guard; // A takes every round -> 4-0 -> the push-off ending
    await answer(A.cookie, st.round, e, true);
    await answer(B.cookie, st.round, e, false);
    const after = (await api(A.cookie, `/api/duel/${id}`)).body;
    console.log(
      `round ${last}: payload score ${after.host.score}-${after.guest?.score ?? 0} · history ${after.history.length}`,
    );
    console.log(
      `round ${last} clash pose:`,
      await waitPose(`clash${last}`, /soldier-(attack|overhead)\.webp/, `${last + 1} - 0`),
    );
  }
  st = (await api(A.cookie, `/api/duel/${id}`)).body;
  console.log(`final ${st.host.score}-${st.guest.score} · ${st.status} · pushedOff ${!!st.pushedOffId}`);
  console.log("finish pose:", await waitPose("finish", /soldier-(victory|hit)\.webp/, "4 - 0"));
  await sleep(1500);
  console.log("after the fall:", await shot("after-fall"));

  cdp.close();
  proc.kill("SIGKILL");

  await prisma.duel.deleteMany({ where: { id } });
  const ids = [host.id, guest.id];
  await prisma.quizSession.deleteMany({ where: { userId: { in: ids } } });
  await prisma.duelAnswer.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
  console.log("cleanup done ·", OUT);
}

main().catch(async (e) => { console.error("SHOT ERROR:", e.message); await prisma.$disconnect(); process.exit(1); });
