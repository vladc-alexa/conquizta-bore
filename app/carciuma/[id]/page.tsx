"use client";

// /carciuma/[id] — one table at La Carciuma. Poll the table state, answer the
// round (grilă: pick a letter; rapidă: type the number), watch who has to
// drink. The art + random tavern antics live in CarciumaScene.
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import CarciumaScene from "@/components/CarciumaScene";
import type { CarciumaState } from "@/lib/carciuma";

const LETTERS = ["A", "B", "C", "D"];

export default function CarciumaPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id as string;
  const router = useRouter();
  const [state, setState] = useState<CarciumaState | null>(null);
  const [err, setErr] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [flashSeat, setFlashSeat] = useState<number | null>(null);
  const roundRef = useRef<number>(-1);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/carciuma/${id}`, { cache: "no-store" });
      if (r.status === 401) {
        router.replace("/login");
        return;
      }
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setErr(d.error || "Masa nu a putut fi încărcată.");
        return;
      }
      const d: CarciumaState = await r.json();
      setState(d);
      setErr("");
      if (d.round !== roundRef.current) {
        roundRef.current = d.round;
        setPicked(null);
        setTyped("");
        const drinker = d.lastRound?.rows.find((x) => x.drank);
        const p = d.players.find((x) => x.id === drinker?.playerId);
        setFlashSeat(p ? p.seat : null);
        window.setTimeout(() => setFlashSeat(null), 4200);
      }
    } catch {
      setErr("Eroare de rețea — încerc din nou.");
    }
  }, [id, router]);

  useEffect(() => {
    void load();
    const t = window.setInterval(() => void load(), 1000);
    const tick = window.setInterval(() => setNow(Date.now()), 120);
    return () => {
      window.clearInterval(t);
      window.clearInterval(tick);
    };
  }, [load]);

  const send = useCallback(
    async (payload: { selectedOptionId?: string; answer?: string }, mark: string) => {
      if (busy || picked || !state?.question) return;
      setBusy(true);
      setPicked(mark);
      try {
        const r = await fetch(`/api/carciuma/${id}/answer`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          setErr(d.error || "Răspunsul nu a ajuns la masă.");
          setPicked(null);
        }
      } catch {
        setErr("Eroare de rețea.");
        setPicked(null);
      } finally {
        setBusy(false);
        void load();
      }
    },
    [busy, id, load, picked, state?.question]
  );

  async function leave() {
    await fetch(`/api/carciuma/${id}/leave`, { method: "POST" }).catch(() => {});
    router.push("/");
  }

  const me = state?.players.find((p) => p.mine) ?? null;
  const openForMe = !!state?.question && !state.myAnswered && !picked && !!me && !me.passedOut && state.startsInMs <= 0;
  const msLeft = state?.question && state.startedAt ? Math.max(0, state.startedAt + state.windowMs - now) : 0;
  const secs = Math.ceil(msLeft / 1000);
  const timeUp = !!state?.question && msLeft <= 0;
  const nextIn = state ? Math.max(0, Math.ceil(state.startsInMs / 1000)) : 0;
  const isRapide = state?.question?.mode === "rapide";

  const scenePlayers = (state?.players ?? []).map((p) => ({
    id: p.id,
    seat: p.seat,
    name: p.name,
    drinks: p.drinks,
    passedOut: p.passedOut,
    mine: p.mine,
    isBot: p.isBot,
    answered: state?.myAnswered ?? false,
  }));

  return (
    <main className="mx-auto w-full max-w-[1180px] px-3 pb-6">
      <div className="flex flex-wrap items-center gap-3 py-3">
        <Link href="/" className="rounded-lg border border-[#3a2a1c] bg-[#1a1208] px-2.5 py-1.5 text-sm text-[#e0c9a6] hover:border-[#8a5a30]">
          ← înapoi
        </Link>
        <h1 className="font-display text-2xl text-[#ffd98e]">La Carciuma</h1>
        <div className="ml-auto flex items-center gap-2 text-xs">
          {state?.phase === "table" && (
            <span className="rounded-full border border-[#5b3d22] bg-[#1d1208] px-2.5 py-1 text-[#e0c9a6]">
              runda {Math.min(state.round + 1, state.totalRounds)}/{state.totalRounds}
            </span>
          )}
          {state && (
            <span className="rounded-full border border-[#5b3d22] bg-[#1d1208] px-2.5 py-1 text-[#e0c9a6]">
              {state.awakeCount} încă la masă
            </span>
          )}
          <button onClick={leave} className="rounded-lg border border-[#6b3a2a] bg-[#2a120c] px-2.5 py-1.5 text-[#f0b9a4] hover:border-[#a8503a]">
            ✕ pleacă de la masă
          </button>
        </div>
      </div>

      {err && <p className="mb-2 rounded-lg border border-[#7a3a2a] bg-[#2a1310] px-3 py-2 text-sm text-[#f2b7a4]">{err}</p>}

      <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_390px]">
        <div className="relative overflow-hidden rounded-2xl border-2 border-[#4b2d17] bg-[#2a170b] shadow-[0_18px_50px_rgba(0,0,0,0.55)]">
          <CarciumaScene
            players={scenePlayers}
            flashSeat={flashSeat}
            winnerSeat={state?.phase === "done" ? state.players.find((p) => p.id === state.winnerId)?.seat ?? null : null}
          />

          {state?.phase === "lobby" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#140b04]/70 backdrop-blur-[1px]">
              <p className="font-display text-3xl text-[#ffd98e]">Masa se deschide…</p>
              <p className="text-sm text-[#e6cfae]">{state.players.length}/5 scaune ocupate · gazda apasă „Începe”</p>
            </div>
          )}

          {state?.phase === "table" && nextIn > 0 && (
            <div className="pointer-events-none absolute inset-x-0 top-[26%] flex justify-center">
              <div className="rounded-xl border-2 border-[#8a5a30] bg-[#1d1208]/95 px-5 py-3 text-center shadow-lg">
                {state.lastRound?.drinkerName ? (
                  <>
                    <p className="font-display text-xl text-[#ffd98e]">„{state.lastRound.drinkerName} bea!”</p>
                    <p className="text-xs text-[#cfae82]">
                      {(() => {
                        const p = state.players.find((x) => x.id === state.lastRound?.drinkerId);
                        return p ? `${p.name} — ${p.drinks}/3 pahare` : "";
                      })()}
                    </p>
                  </>
                ) : (
                  <p className="font-display text-lg text-[#ffd98e]">Se mai toarnă…</p>
                )}
                <p className="mt-1 text-[0.7rem] uppercase tracking-wider text-[#9d7c56]">runda următoare în {nextIn}s</p>
              </div>
            </div>
          )}

          {state?.phase === "done" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#140b04]/72 px-4 text-center">
              <p className="font-display text-4xl text-[#ffd98e]">Cin cin!</p>
              <p className="text-lg text-[#f0dcbb]">
                {state.winnerName ? (
                  <>
                    <span className="font-semibold text-[#8fd9a8]">{state.winnerName}</span> a rămas singurul la masă.
                  </>
                ) : (
                  "Toată masa e pe jos. Barmanul strânge paharele."
                )}
              </p>
              <Link href="/" className="rounded-lg border border-[#8a5a30] bg-[#3a2512] px-4 py-2 text-sm text-[#ffe4ac] hover:border-[#c08850]">
                înapoi la carciumă
              </Link>
            </div>
          )}
        </div>

        {/* the round panel: beside the table on desktop, so it is never below the fold */}
        {state?.phase === "table" && (
          <aside className="flex flex-col gap-2 lg:sticky lg:top-2">
            <section className="rounded-2xl border border-[#5b3d22] bg-[#1a1208] p-3">
              {state.question && nextIn === 0 ? (
                <>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className={`rounded px-1.5 py-0.5 text-[0.62rem] font-bold uppercase tracking-wider ${isRapide ? "bg-[#22303a] text-[#9ed2e0]" : "bg-[#33220f] text-[#e2b877]"}`}>
                      {isRapide ? "rapidă" : "grilă"}
                    </span>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${secs <= 5 ? "bg-[#5a1f14] text-[#ffb59c]" : "bg-[#24301f] text-[#b9e0a6]"}`}>
                      {secs}s
                    </span>
                  </div>
                  <p className="mb-2 text-[0.95rem] leading-snug text-[#f0dcbb]">{state.question.prompt}</p>
                  <div className="mb-3 h-1.5 w-full overflow-hidden rounded-full bg-[#2c1c0e]">
                    <div className="h-full rounded-full bg-[#e2a34a] transition-[width] duration-150" style={{ width: `${Math.max(0, Math.min(100, (msLeft / state.windowMs) * 100))}%` }} />
                  </div>

                  {isRapide ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const v = typed.trim();
                        if (v) void send({ answer: v }, `a:${v}`);
                      }}
                      className="flex items-center gap-2"
                    >
                      <input
                        value={typed}
                        onChange={(e) => setTyped(e.target.value)}
                        inputMode="numeric"
                        autoFocus
                        disabled={!openForMe || timeUp}
                        placeholder="scrie numărul…"
                        className="min-w-0 flex-1 rounded-lg border border-[#5b3d22] bg-[#241708] px-3 py-2 text-sm text-[#f0dcbb] outline-none focus:border-[#c08850] disabled:opacity-50"
                      />
                      <button
                        type="submit"
                        disabled={!openForMe || timeUp || !typed.trim()}
                        className="rounded-lg border border-[#8a5a30] bg-[#3a2512] px-3 py-2 text-sm text-[#ffe4ac] hover:border-[#c08850] disabled:opacity-40"
                      >
                        trimite
                      </button>
                    </form>
                  ) : (
                    <div className="grid gap-2">
                      {state.question.options.map((o, i) => {
                        const isPicked = picked === o.id;
                        const locked = !openForMe || timeUp;
                        return (
                          <button
                            key={o.id}
                            onClick={() => void send({ selectedOptionId: o.id }, o.id)}
                            disabled={locked}
                            className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-left text-sm transition ${
                              isPicked
                                ? "border-[#e2a34a] bg-[#3a2a12] text-[#ffe4ac]"
                                : locked
                                  ? "border-[#33220f] bg-[#150e06] text-[#8a7358]"
                                  : "border-[#5b3d22] bg-[#241708] text-[#e8d7bd] hover:border-[#c08850] hover:bg-[#33220f]"
                            }`}
                          >
                            <span className="mt-0.5 shrink-0 rounded bg-[#3a2a16] px-1.5 text-[0.7rem] font-bold text-[#e2b877]">{LETTERS[i]}</span>
                            <span>{o.text}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  <p className="mt-2 text-xs text-[#9d7c56]">
                    {me?.passedOut
                      ? "Ai căzut sub masă — urmărești de pe podea."
                      : state.myAnswered || picked
                        ? `Răspuns trimis. ${state.answeredCount}/5 au răspuns.`
                        : timeUp
                          ? "Timpul a expirat."
                          : "Cine răspunde cel mai prost (sau cel mai încet) bea."}
                  </p>
                </>
              ) : (
                <div>
                  <p className="mb-2 text-sm text-[#e0c9a6]">
                    {nextIn > 0 ? `Pauză — se mai toarnă un rând. Runda următoare în ${nextIn}s.` : "Se pregătește runda…"}
                  </p>
                  {state.lastRound && (
                    <ul className="grid gap-1 text-xs">
                      {state.lastRound.rows.map((row) => {
                        const p = state.players.find((x) => x.id === row.playerId);
                        if (!p) return null;
                        return (
                          <li key={row.playerId} className={`flex items-center gap-2 rounded-lg px-2 py-1 ${row.drank ? "bg-[#3a1c0e] text-[#ffd0a8]" : "bg-[#221606] text-[#c8b79c]"}`}>
                            <span className="w-24 truncate">{p.name}</span>
                            <span className={row.correct ? "text-[#8fd9a8]" : "text-[#c98b7a]"}>{row.correct ? "corect" : "greșit"}</span>
                            <span className="text-[#8d755a]">{(row.ms / 1000).toFixed(1)}s</span>
                            <span className="ml-auto font-semibold">{row.score}p</span>
                            {row.drank && <span className="rounded bg-[#7a2f16] px-1.5 py-0.5 text-[0.65rem] uppercase tracking-wide text-[#ffd0a8]">bea</span>}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              )}
            </section>
          </aside>
        )}
      </div>
    </main>
  );
}
