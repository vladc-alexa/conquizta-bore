"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";

type AnswerRow = { userId: string; isCorrect: boolean; elapsedMs: number; score: number | null; mine: boolean };
type HistoryRow = {
  round: number;
  mode: "grila" | "rapide";
  prompt: string;
  reveal: string;
  winnerId: string | null;
  answers: AnswerRow[];
};
type DuelState = {
  id: string;
  status: "WAITING" | "IN_PROGRESS" | "COMPLETED" | "ABANDONED";
  role: "host" | "guest" | null;
  host: { id: string; name: string; score: number };
  guest: { id: string; name: string; score: number } | null;
  round: number;
  totalRounds: number;
  mode: "grila" | "rapide" | null;
  prompt: string | null;
  options: { id: string; text: string }[] | null;
  responseType: string | null;
  startedAt: number | null;
  windowMs: number | null;
  myAnswered: boolean;
  opponentAnswered: boolean;
  history: HistoryRow[];
  winnerId: string | null;
  draw: boolean;
};

const CARD = "bg-gradient-to-br from-[#3d2510] to-[#2a1608] border-2 border-[#7a4e22] rounded-2xl shadow-2xl";
const BTN_MAIN =
  "bg-gradient-to-br from-[#c87030] to-[#7a4010] border-2 border-[#f5c97a60] rounded-lg text-[#f5e8c0] font-cinzel p-3 hover:brightness-110 cursor-pointer";

export default function DuelMatch() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const [state, setState] = useState<DuelState | null>(null);
  const [err, setErr] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [selected, setSelected] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [localSent, setLocalSent] = useState(false);
  const [flash, setFlash] = useState<"ok" | "bad" | null>(null);
  const [copied, setCopied] = useState(false);
  const lastRound = useRef<number | null>(null);

  // Sit down (idempotent) then poll the match state.
  useEffect(() => {
    if (!id) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    (async () => {
      try {
        await fetch(`/api/duel/${id}/join`, { method: "POST" });
      } catch {
        /* ignore */
      }
      const tick = async () => {
        try {
          const r = await fetch(`/api/duel/${id}`, { cache: "no-store" });
          if (r.status === 401) {
            window.location.href = "/login";
            return;
          }
          if (r.ok) {
            setState(await r.json());
            setErr("");
          } else if (r.status === 403) setErr("Nu faci parte din acest meci.");
          else if (r.status === 404) setErr("Meciul nu există sau a expirat.");
        } catch {
          /* keep polling */
        }
        if (!stop) timer = setTimeout(tick, 1200);
      };
      tick();
    })();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [id]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(t);
  }, []);

  // New round -> clear the previous answer's local UI.
  useEffect(() => {
    if (state?.round != null && state.round !== lastRound.current) {
      lastRound.current = state.round;
      setSelected(null);
      setTyped("");
      setLocalSent(false);
      setFlash(null);
    }
  }, [state?.round]);

  const me = state ? (state.role === "host" ? state.host : state.guest) : null;
  const opp = state ? (state.role === "host" ? state.guest : state.host) : null;

  const deadline = state?.startedAt != null && state?.windowMs != null ? state.startedAt + state.windowMs : null;
  const timeLeft = deadline ? Math.max(0, (deadline - now) / 1000) : null;
  const sent = localSent || !!state?.myAnswered;
  const canAnswer =
    state?.status === "IN_PROGRESS" && state?.mode != null && !sent && (timeLeft == null || timeLeft > 0);

  async function send(payload: Record<string, unknown>) {
    setLocalSent(true);
    try {
      const r = await fetch(`/api/duel/${id}/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ round: state!.round, ...payload }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setLocalSent(false);
        setSelected(null);
        setErr(d.error || "N-am putut trimite răspunsul.");
        return;
      }
      setFlash(d.mode === "grila" ? (d.isCorrect ? "ok" : "bad") : null);
    } catch {
      setLocalSent(false);
      setErr("Eroare de rețea.");
    }
  }

  async function abandon() {
    if (!window.confirm("Abandonezi meciul?")) return;
    try {
      await fetch(`/api/duel/${id}/leave`, { method: "POST" });
    } catch {
      /* ignore */
    }
    window.location.href = "/duel";
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/duel/${id}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }

  // ---------- error / empty ----------
  if (err && !state) {
    return (
      <div className={`${CARD} w-full max-w-[560px] mx-auto p-7 text-center flex flex-col gap-4`}>
        <h2 className="font-cinzel text-[#f5c97a] text-[1.2rem]">⚔️ 1 la 1</h2>
        <p className="text-[#e8d8b0] text-[0.95rem]">{err}</p>
        <button onClick={() => (window.location.href = "/duel")} className={BTN_MAIN}>
          ← Înapoi la lobby
        </button>
      </div>
    );
  }
  if (!state || !me) {
    return (
      <div className={`${CARD} w-full max-w-[560px] mx-auto p-7 text-center`}>
        <p className="text-[#a07848] text-[0.9rem]">Se încarcă meciul…</p>
      </div>
    );
  }

  const scoreboard = (
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-center">
      <div className="bg-[#1a0e05] border-2 border-[#c87030] rounded-xl p-2.5">
        <div className="text-[0.7rem] text-[#a07848] truncate">Tu · {me.name}</div>
        <div className="font-cinzel text-[#f5c97a] text-[1.4rem]">{me.score}</div>
      </div>
      <div className="font-cinzel text-[#7a4e22] text-[0.9rem]">VS</div>
      <div className="bg-[#1a0e05] border-2 border-[#7a4e22] rounded-xl p-2.5">
        <div className="text-[0.7rem] text-[#a07848] truncate">{opp ? opp.name : "…"}</div>
        <div className="font-cinzel text-[#e8d8b0] text-[1.4rem]">{opp ? opp.score : 0}</div>
      </div>
    </div>
  );

  // ---------- waiting for an opponent ----------
  if (state.status === "WAITING") {
    return (
      <div className={`${CARD} w-full max-w-[520px] mx-auto p-7 flex flex-col gap-4 text-center`}>
        <h2 className="font-cinzel text-[#f5c97a] text-[1.3rem] tracking-widest">⏳ Aștept adversarul</h2>
        <p className="text-[#e8d8b0] text-[0.9rem] leading-relaxed">
          Trimite-i linkul (sau codul) prietenului tău ca să înceapă meciul.
        </p>
        <div className="bg-[#1a0e05] border-2 border-[#7a4e22] rounded-xl p-3 font-mono text-[0.8rem] text-[#c8a070] break-all">
          {id}
        </div>
        <div className="flex gap-2.5">
          <button onClick={copyLink} className={`${BTN_MAIN} flex-1`}>
            {copied ? "Copiat ✓" : "📋 Copiază linkul"}
          </button>
          <button
            onClick={abandon}
            className="flex-1 bg-gradient-to-br from-[#3d2010] to-[#2a1608] border-2 border-[#7a4e22] rounded-lg text-[#c8a070] font-cinzel p-3 hover:brightness-125 cursor-pointer"
          >
            Anulează
          </button>
        </div>
      </div>
    );
  }

  // ---------- finished / abandoned ----------
  if (state.status === "COMPLETED" || state.status === "ABANDONED") {
    const won = state.status === "COMPLETED" && state.winnerId === me.id;
    const lost = state.status === "COMPLETED" && state.winnerId != null && state.winnerId !== me.id;
    const banner =
      state.status === "ABANDONED"
        ? "🚪 Meci abandonat"
        : state.draw
          ? "🤝 Egalitate"
          : won
            ? "🏆 Ai câștigat!"
            : lost
              ? "😤 Ai pierdut"
              : "🏁 Meci încheiat";
    return (
      <div className="w-full max-w-[620px] mx-auto flex flex-col gap-4">
        <div className={`${CARD} p-6 flex flex-col gap-4 text-center`}>
          <h2 className="font-cinzel text-[#f5c97a] text-[1.5rem]">{banner}</h2>
          {scoreboard}
          <div className="flex gap-2.5 flex-wrap">
            <button onClick={() => (window.location.href = "/duel")} className={`${BTN_MAIN} flex-1 min-w-[140px]`}>
              ⚔️ Încă un meci
            </button>
            <button
              onClick={() => (window.location.href = "/")}
              className="flex-1 min-w-[140px] bg-gradient-to-br from-[#7a4010] to-[#3d2010] border-2 border-[#c88040a0] rounded-lg text-[#f5e8c0] font-cinzel p-3 hover:brightness-125 cursor-pointer"
            >
              ← Înapoi
            </button>
          </div>
        </div>

        {state.history.length > 0 && (
          <div className={`${CARD} p-5 flex flex-col gap-2`}>
            <h3 className="font-cinzel text-[#f5c97a] text-[0.9rem] tracking-widest">📋 Runde</h3>
            {state.history.map((h) => {
              const w = h.winnerId === me.id ? "tu" : h.winnerId ? "adversarul" : "nimeni";
              return (
                <div key={h.round} className="bg-[#1a0e05] border border-[#7a4e2260] rounded-xl p-3 flex flex-col gap-1">
                  <div className="flex items-center justify-between gap-2 text-[0.72rem] text-[#a07848]">
                    <span>
                      #{h.round + 1} · {h.mode === "rapide" ? "Rapidă" : "Grilă"}
                    </span>
                    <span className={h.winnerId === me.id ? "text-green-400" : h.winnerId ? "text-red-400" : "text-[#a07848]"}>
                      {h.winnerId === me.id ? "✔ câștigată" : h.winnerId ? "✖ pierdută" : "– egal"}
                    </span>
                  </div>
                  <div className="text-[0.88rem] text-[#e8d8b0] leading-snug">{h.prompt}</div>
                  <div className="text-[0.78rem] text-[#c8a070]">
                    Corect: <strong className="text-[#f5c97a]">{h.reveal}</strong>
                    {h.answers.map((a, i) => (
                      <span key={i} className={a.mine ? "text-[#f5c97a]" : "text-[#a07848]"}>
                        {" · "}
                        {a.mine ? "tu" : "adv"} {a.isCorrect ? "✔" : "✖"} {(a.elapsedMs / 1000).toFixed(1)}s
                        {a.score != null ? ` (${a.score}p)` : ""}
                      </span>
                    ))}
                    <span className="text-[#7a5a30]"> · câștigă: {w}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ---------- playing ----------
  const isGrila = state.mode === "grila";
  const pct = timeLeft != null && state.windowMs ? (timeLeft / (state.windowMs / 1000)) * 100 : 0;
  const chips = state.history.slice(-8);

  return (
    <div className="w-full max-w-[620px] mx-auto flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <button
          onClick={abandon}
          className="text-[#c8a070] hover:text-[#f5c97a] text-[0.85rem] font-cinzel border border-[#7a4e22] rounded-lg px-3 py-1.5 bg-[#2a1608] cursor-pointer"
        >
          🚪 Abandonează
        </button>
        <span className="text-[0.7rem] text-[#a07848]">
          Runda {state.round + 1} / {state.totalRounds} · {isGrila ? "Grilă" : "Rapidă"}
        </span>
      </div>

      {scoreboard}

      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1.5 justify-center">
          {chips.map((h) => (
            <span
              key={h.round}
              title={h.prompt}
              className={`text-[0.68rem] px-2 py-0.5 rounded-full border ${
                h.winnerId === me.id
                  ? "border-green-500/50 text-green-400 bg-green-900/20"
                  : h.winnerId
                    ? "border-red-500/50 text-red-400 bg-red-900/20"
                    : "border-[#7a4e22] text-[#a07848] bg-[#1a0e05]"
              }`}
            >
              #{h.round + 1} {h.mode === "rapide" ? "R" : "G"}
            </span>
          ))}
        </div>
      )}

      <div className={`${CARD} p-7 flex flex-col gap-5`}>
        <div className="flex items-center gap-3">
          <div
            className={`w-[52px] h-[52px] rounded-full border-2 flex items-center justify-center font-cinzel text-[1.1rem] shrink-0 ${
              timeLeft != null && timeLeft <= 3 ? "border-red-500 text-red-400" : "border-[#f5c97a] text-[#f5c97a]"
            }`}
          >
            {timeLeft != null ? Math.ceil(timeLeft) : "–"}
          </div>
          <div className="flex-1 h-2 bg-[#1a0e05] rounded overflow-hidden border border-[#7a4e2240]">
            <div
              className={`h-full transition-all duration-100 ${timeLeft != null && timeLeft <= 3 ? "bg-red-500" : "bg-gradient-to-r from-[#c87030] to-[#f5c97a]"}`}
              style={{ width: `${pct}%` }}
            ></div>
          </div>
        </div>

        <p className="font-cinzel text-[1.05rem] leading-relaxed min-h-[60px]">{state.prompt}</p>

        {!isGrila && state.responseType && (
          <div className="self-start text-[0.7rem] text-[#2a1608] bg-[#c87030]/90 rounded-full px-2.5 py-1 font-bold tracking-wide">
            Răspuns: {state.responseType}
          </div>
        )}

        {isGrila ? (
          <div className="grid grid-cols-1 gap-2.5">
            {(state.options ?? []).map((opt, i) => {
              const isSel = selected === opt.id;
              let cls = "bg-[#1a0e05] border-2 border-[#7a4e22] hover:border-[#c87030] hover:bg-[#2a1608]";
              if (isSel && flash === "ok") cls = "bg-green-900/30 border-green-500/60 text-[#f5e8c0]";
              else if (isSel && flash === "bad") cls = "bg-red-900/30 border-red-500/60 text-[#f5e8c0]";
              else if (isSel) cls = "bg-[#2a1608] border-[#c87030] text-[#f5e8c0]";
              else if (sent) cls = "bg-[#1a0e05] border-[#4a3a20] opacity-60";
              return (
                <button
                  key={opt.id}
                  disabled={!canAnswer}
                  onClick={() => {
                    setSelected(opt.id);
                    void send({ selectedOptionId: opt.id });
                  }}
                  className={`${cls} rounded-xl text-left p-3.5 text-[0.95rem] cursor-pointer disabled:cursor-default transition-all`}
                >
                  <span className="font-cinzel text-[#c87030] mr-2">{String.fromCharCode(65 + i)}.</span>
                  {opt.text}
                </button>
              );
            })}
          </div>
        ) : (
          <div className="flex gap-2">
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && canAnswer && typed.trim() && void send({ answer: typed.trim() })}
              disabled={!canAnswer}
              inputMode="numeric"
              placeholder={state.responseType === "an" ? "ex: 1989" : "număr"}
              className="flex-1 bg-[#1a0e05] border-2 border-[#7a4e22] rounded-xl p-3.5 text-[1rem] text-[#f0e0c0] placeholder-[#7a5a30] focus:border-[#c87030] outline-none disabled:opacity-60"
            />
            <button
              onClick={() => void send({ answer: typed.trim() })}
              disabled={!canAnswer || !typed.trim()}
              className={`${BTN_MAIN} px-6 disabled:opacity-50`}
            >
              Trimite
            </button>
          </div>
        )}

        <div className="text-center text-[0.8rem] min-h-[18px]">
          {sent ? (
            <span className="text-[#c8a070]">
              {flash === "ok" ? "✔ Răspuns corect — " : flash === "bad" ? "✖ Răspuns greșit — " : ""}
              {state.opponentAnswered ? "se încheie runda…" : "aștept adversarul…"}
            </span>
          ) : timeLeft === 0 ? (
            <span className="text-red-400">⏱ Timpul a expirat</span>
          ) : state.opponentAnswered ? (
            <span className="text-[#a07848]">adversarul a răspuns — grăbește-te!</span>
          ) : (
            <span className="text-[#7a5a30]">răspunde înainte să expire timpul</span>
          )}
        </div>
      </div>
    </div>
  );
}
