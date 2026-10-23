// Race probe: hammer the table state from several tabs at round close and make
// sure a round is only ever settled once (one drink per settled round).
const BASE = process.env.BASE || "http://127.0.0.1:3111";
const login = await fetch(BASE + "/api/auth/login", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: "vlad@demo.local", password: "parola12345" }),
});
const cookie = (login.headers.get("set-cookie") || "").split(";")[0];
const H = { cookie, "Content-Type": "application/json" };
const get = (p) => fetch(BASE + p, { headers: H, cache: "no-store" }).then((r) => r.json());

const made = await fetch(BASE + "/api/carciuma", { method: "POST", headers: H }).then((r) => r.json());
const id = made.gameId;
await fetch(BASE + `/api/carciuma/${id}/start`, { method: "POST", headers: H });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastRound = 0;
for (let tick = 0; tick < 40; tick++) {
  const before = await get(`/api/carciuma/${id}`);
  if (before.status !== "IN_PROGRESS") break;
  // six concurrent readers, all of which will try to settle the same round
  await Promise.all(Array.from({ length: 6 }, () => get(`/api/carciuma/${id}`)));
  await sleep(400);
}

const st = await get(`/api/carciuma/${id}`);
const drinks = st.players.reduce((n, p) => n + p.drinks, 0);
const settled = st.status === "COMPLETED" ? st.round + 1 : st.round;
console.log(JSON.stringify({ status: st.status, round: st.round, drinks, settled, winner: st.winnerName }, null, 0));
console.log(drinks === settled ? "OK: one drink per settled round" : `MISMATCH: ${drinks} drinks vs ${settled} settled rounds`);
