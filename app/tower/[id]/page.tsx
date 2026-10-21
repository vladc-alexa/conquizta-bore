"use client";

// /tower/[id] — one tower: lobby, then rounds of climbing until someone tops out.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Tower from "@/components/Tower";
import type { TowerState } from "@/lib/tower";

export default function TowerGamePage() {
  const params = useParams<{ id: string }>();
  const id = params?.id as string;
  const router = useRouter();
  const [state, setState] = useState<TowerState | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ correct: boolean; rungs: number } | null>(null);
  const [now, setNow] = useState(Date.now());
  const roundRef = useRef<number>(-1);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/tower/${id}`, { cache: "no-store" });
      if (r.status === 401) {
        router.replace("/login");
        return;
      }
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setErr(d.error || "Turnul nu a putut fi încărcat.");
        return;
      }
      const d: TowerState = await r.json();
      setState(d);
      if (d.round !== roundRef.current) {
        roundRef.current = d.round;
        setPicked(null);
        setFeedback(null);
      }
    } catch {
      /* keep the last state */
    }
  }, [id, router]);

  useEffect(() => {
    load();
    const t = setInterval(load, 1500);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);

  const msLeft = useMemo(() => {
    if (!state?.startedAt) return 0;
    return Math.max(0, state.startedAt + state.windowMs - now);
  }, [state?.startedAt, state?.windowMs, now]);

  async function answer(optionId: string) {
    if (!state || picked) return;
    setPicked(optionId);
    try {
      const r = await fetch(`/api/tower/${id}/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selectedOptionId: optionId }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErr(d.error || "Răspunsul nu a fost înregistrat.");
        return;
      }
      setFeedback({ correct: !!d.isCorrect, rungs: Number(d.rungs) || 0 });
      load();
    } catch {
      setErr("Eroare de rețea.");
    }
  }

  async function startGame() {
    setBusy(true);
    setErr("");
    try {
      const r = await fetch(`/api/tower/${id}/start`, { method: "POST" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) setErr(d.error || "N-am putut porni turnul.");
      await load();
    } catch {
      setErr("Eroare de rețea.");
    }
    setBusy(false);
  }

  async function leave() {
    if (!window.confirm("Ieși din turn?")) return;
    try {
      await fetch(`/api/tower/${id}/leave`, { method: "POST" });
    } catch {
      /* ignore */
    }
    router.push("/tower");
  }

  if (!state) {
    return (
      <div className="w-full max-w-3xl text-center text-[#75938f] py-16">
        {err || "Se încarcă turnul…"}
      </div>
    );
  }

  const me = state.players.find((p) => p.mine) ?? null;
  const champion = state.players.find((p) => p.id === state.winnerId) ?? null;
  const eliminated = state.players.find((p) => p.id === state.eliminatedId) ?? null;
  const ranked = [...state.players].sort((a, b) => b.rungs - a.rungs || b.score - a.score);

  return (
    <div className="w-full max-w-[1700px] px-3 flex flex-col gap-4 py-2">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-cinzel text-[#9ec6c1] text-[1.2rem] tracking-widest">🏰 TURNUL</h1>
          <p className="text-[#75938f] text-[0.72rem]">
            {state.phase === "lobby"
              ? "Aștept jucători — locurile libere se umplu cu boți la start"
              : state.phase === "final"
                ? `SPRINT FINAL · runda ${state.round + 1} · cine ajunge sus câștigă`
                : state.phase === "done"
                  ? "Turnul a fost cucerit"
                  : state.round + 1 <= state.cutRound
                    ? `Runda ${state.round + 1} · toți urcă până la runda ${state.cutRound} · sus = ${state.height} trepte`
                    : `Runda ${state.round + 1} · ultimul cade la finalul rundei · sus = ${state.height} trepte`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a href="/tower" className="font-cinzel text-[#8fb0ac] hover:text-[#9ec6c1] text-[0.78rem] border border-[#1e3a34] rounded-lg px-3 py-1.5 bg-[#0c1a17]">
            ← Lobby
          </a>
          <button onClick={leave} className="font-cinzel text-[#c98b6b] hover:text-[#e8a98b] text-[0.78rem] border border-[#3a2a24] rounded-lg px-3 py-1.5 bg-[#160f0d] cursor-pointer">
            🚪 Ieși
          </button>
        </div>
      </div>

      {/* the board gets every pixel the side panel doesn't need: it used to be
          capped by max-w-6xl (≈700px even on a 1920 screen) */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(310px,340px)] gap-4 items-start">
        <Tower players={state.players} />

        <div className="flex flex-col gap-3">
          {/* ---- lobby ---- */}
          {state.phase === "lobby" && (
            <div className="bg-gradient-to-br from-[#122420] to-[#0c1a17] border-2 border-[#1e3a34] rounded-2xl p-4 flex flex-col gap-3">
              <h3 className="font-cinzel text-[#9ec6c1] text-[0.9rem] tracking-widest">Masa de start</h3>
              <div className="grid grid-cols-2 gap-1.5 text-[0.78rem]">
                {Array.from({ length: 8 }, (_, seat) => {
                  const p = state.players.find((x) => x.seat === seat);
                  return (
                    <div key={seat} className="border border-[#1e3a34] rounded-lg px-2 py-1.5 text-[#75938f]">
                      {p ? <span className="text-[#cbdcda]">{p.name}</span> : <span>loc liber</span>}
                    </div>
                  );
                })}
              </div>
              {state.isHost ? (
                <button
                  onClick={startGame}
                  disabled={busy}
                  className="bg-gradient-to-br from-[#d9a441] to-[#9c7020] border-2 border-[#d9a44180] rounded-xl text-[#0c1a17] font-cinzel text-[0.9rem] p-3 hover:brightness-110 disabled:opacity-60 cursor-pointer"
                >
                  {busy ? "Se pornește…" : "▶ Începe (boții ocupă locurile libere)"}
                </button>
              ) : (
                <div className="text-[#75938f] text-[0.78rem] text-center">
                  Aștept gazda să pornească turnul…
                </div>
              )}
            </div>
          )}

          {/* ---- question ---- */}
          {state.question && state.phase !== "lobby" && state.phase !== "done" && (
            <div className="bg-gradient-to-br from-[#122420] to-[#0c1a17] border-2 border-[#1e3a34] rounded-2xl p-4 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="font-cinzel text-[#9ec6c1] text-[0.8rem] tracking-widest">
                  {state.phase === "final" ? `RUNDA ${state.round + 1} · SPRINT FINAL` : `RUNDA ${state.round + 1}`}
                </span>
                <span className={`text-[0.78rem] tabular-nums ${msLeft < 4000 ? "text-[#c98b6b]" : "text-[#75938f]"}`}>
                  {Math.ceil(msLeft / 1000)}s
                </span>
              </div>
              <div className="h-1 rounded bg-[#1e3a34] overflow-hidden">
                <div
                  className="h-full bg-[#9ec6c1] transition-[width] duration-200"
                  style={{ width: `${Math.max(0, Math.min(100, (msLeft / state.windowMs) * 100))}%` }}
                />
              </div>
              <p className="text-[#dfe7e5] text-[0.95rem] leading-snug">{state.question.prompt}</p>
              <div className="flex flex-col gap-1.5">
                {state.question.options.map((o, i) => {
                  const isPicked = picked === o.id;
                  return (
                    <button
                      key={o.id}
                      onClick={() => answer(o.id)}
                      disabled={!!picked || state.myAnswered}
                      className={`text-left border-2 rounded-xl px-3 py-2 text-[0.85rem] transition ${
                        isPicked
                          ? "border-[#9ec6c1] bg-[#1b3330] text-[#e6f2ef]"
                          : "border-[#1e3a34] bg-[#050d0b] text-[#cbdcda] hover:border-[#4d7a76]"
                      } disabled:opacity-60`}
                    >
                      <span className="text-[#75938f] mr-2">{"ABCD"[i]}</span>
                      {o.text}
                    </button>
                  );
                })}
              </div>
              {feedback ? (
                <div className={`text-[0.8rem] ${feedback.correct ? "text-[#8fd9a8]" : "text-[#c98b6b]"}`}>
                  {feedback.correct ? `Corect · +${feedback.rungs} trepte` : "Greșit · ai stat pe loc"}
                </div>
              ) : state.myAnswered ? (
                <div className="text-[#75938f] text-[0.78rem]">Răspuns înregistrat. Aștept ceilalți…</div>
              ) : me?.eliminated ? (
                <div className="text-[#c98b6b] text-[0.78rem]">Ai căzut de pe scară — privește cine ajunge sus.</div>
              ) : (
                <div className="text-[#75938f] text-[0.7rem]">
                  {state.answeredCount}/{state.liveCount} au răspuns
                </div>
              )}
            </div>
          )}

          {/* ---- finished ---- */}
          {state.phase === "done" && (
            <div className="bg-gradient-to-br from-[#2a2415] to-[#0c1a17] border-2 border-[#d9a44180] rounded-2xl p-4 flex flex-col gap-2 text-center">
              <div className="text-[1.6rem]">👑</div>
              <div className="font-cinzel text-[#e8c46a] text-[1rem] tracking-widest">
                {champion?.mine ? "AI CUCERIT TURNUL!" : `${champion?.name ?? "?"} a cucerit turnul`}
              </div>
              <div className="text-[#cfe0dd] text-[0.8rem]">
                {champion ? `${champion.score} puncte · ${champion.rungs} trepte` : ""}
              </div>
              <a
                href="/tower"
                className="mt-1 bg-gradient-to-br from-[#9ec6c1] to-[#6f9c99] rounded-xl text-[#0c1a17] font-cinzel text-[0.85rem] p-2.5 hover:brightness-110"
              >
                Încă un turn
              </a>
            </div>
          )}

          {/* ---- standings ---- */}
          <div className="bg-gradient-to-br from-[#122420] to-[#0c1a17] border-2 border-[#1e3a34] rounded-2xl p-3 flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-[0.7rem] text-[#75938f] uppercase tracking-wider px-1">
              <span>Scară</span>
              <span>puncte</span>
            </div>
            {ranked.map((p, i) => (
              <div
                key={p.id}
                className={`flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-[0.82rem] ${
                  p.mine ? "bg-[#1b3330] border border-[#4d7a76]" : "bg-[#050d0b] border border-[#1e3a34]"
                } ${p.eliminated ? "opacity-60" : ""}`}
              >
                <span className="min-w-0 truncate">
                  <span className="text-[#75938f] mr-1.5">{i + 1}.</span>
                  <span className="text-[#cbdcda]">{p.name}</span>
                  {p.mine && <span className="text-[#9ec6c1]"> (tu)</span>}
                  {p.id === state.winnerId && <span> 👑</span>}
                  {p.eliminated && <span> 💀</span>}
                </span>
                <span className="shrink-0 text-[#9ec6c1] tabular-nums">
                  {p.rungs}▲ <span className="text-[#75938f]">{p.score}</span>
                </span>
              </div>
            ))}
            {eliminated && state.phase !== "done" && (
              <div className="text-[0.7rem] text-[#c98b6b] text-center pt-1">
                {eliminated.name} a căzut de pe scară după runda{" "}
                {eliminated.fellRound ?? state.cutRound}
              </div>
            )}
          </div>

          {err && <div className="text-red-400 text-[0.78rem]">{err}</div>}
        </div>
      </div>

      {/* ---- round-by-round ---- */}
      {state.history.length > 0 && (
        <div className="bg-[#0c1a17] border border-[#1e3a34] rounded-2xl p-3">
          <div className="text-[0.7rem] text-[#75938f] uppercase tracking-wider mb-2">Runde jucate</div>
          <ol className="flex flex-col gap-1.5">
            {[...state.history].reverse().map((h) => {
              const best = state.players.find((p) => p.id === h.bestPlayerId);
              const mineGain = h.gains.find((g) => g.playerId === me?.id);
              return (
                <li key={h.round} className="text-[0.78rem] text-[#93a8a4] flex items-baseline gap-2">
                  <span className="text-[#75938f] shrink-0">R{h.round + 1}</span>
                  <span className="min-w-0 truncate">{h.prompt}</span>
                  <span className="text-[#8fd9a8] shrink-0">→ {h.reveal}</span>
                  {best && <span className="shrink-0 text-[#9ec6c1]">{best.name}</span>}
                  {mineGain && (
                    <span className="shrink-0 text-[#75938f]">
                      tu +{mineGain.rungs}▲
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </div>
  );
}
