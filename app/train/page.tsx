"use client";

// Train = a 2-minute blitz. The clock is the only limit: answer as many mixed
// questions as you can (two grilă for every rapidă) and the score is how many
// you got right. Results land in the "Antrenament" tab on the clasament page.

import { useEffect, useRef, useState } from "react";
import PromptText from "@/components/PromptText";

interface RapideQuestion {
  id: string;
  prompt: string;
  answer: number;
  responseType?: string;
}

interface GrilaQuestion {
  id: string;
  prompt: string;
  options: { id: string; text: string }[];
  correctIndex: number;
}

type Question = (RapideQuestion | GrilaQuestion) & { mode: "grila" | "rapide" };

// 2 minutes is the game. `?t=<seconds>` shortens a run for smoke tests — it can
// only make your own run shorter, never score you more.
const DURATION_MS = (() => {
  if (typeof window === "undefined") return 120_000;
  const s = Number(new URLSearchParams(window.location.search).get("t"));
  return Number.isFinite(s) && s >= 5 && s <= 120 ? Math.floor(s) * 1000 : 120_000;
})();
// enough questions for even a fast player: ~2.5s per question is 48 in two
// minutes, so 40 grilă + 20 rapidă leaves headroom without a second fetch
const GRILA_WANTED = 40;
const RAPIDE_WANTED = 20;

function mmss(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** 2 grilă : 1 rapidă, keeping whatever is left of the shorter pool. */
function interleave(grila: Question[], rapide: Question[]): Question[] {
  const out: Question[] = [];
  let g = 0;
  let r = 0;
  while (g < grila.length || r < rapide.length) {
    for (let k = 0; k < 2 && g < grila.length; k++) out.push(grila[g++]);
    if (r < rapide.length) out.push(rapide[r++]);
  }
  return out;
}

export default function TrainPage() {
  const [phase, setPhase] = useState<"idle" | "loading" | "playing" | "finished">("idle");
  const [loadError, setLoadError] = useState("");
  const [queue, setQueue] = useState<Question[]>([]);
  const [idx, setIdx] = useState(0);
  const [correct, setCorrect] = useState(0);
  const [wrong, setWrong] = useState(0);
  const [timeLeft, setTimeLeft] = useState(DURATION_MS);
  const [feedback, setFeedback] = useState<{ state: "correct" | "wrong" | "skip"; reveal: string } | null>(null);
  const [inputValue, setInputValue] = useState("");
  const [selectedOption, setSelectedOption] = useState<number | null>(null);

  interface ReviewItem {
    id: string;
    prompt: string;
    myAnswer: string;
    correctAnswer: string;
    isCorrect: boolean;
  }
  const [review, setReview] = useState<ReviewItem[]>([]);
  const [showReview, setShowReview] = useState(false);
  // questions the player flagged from the review list (one flag per question)
  const [reported, setReported] = useState<Set<string>>(new Set());
  const [reportErr, setReportErr] = useState("");

  // today's training standing, filled after the run is saved
  const [standing, setStanding] = useState<{
    mine: { rank: number; correct: number } | null;
    rows: { id: string; name: string; correct: number }[];
  } | null>(null);

  const queueRef = useRef<Question[]>([]);
  const idxRef = useRef(0);
  const correctRef = useRef(0);
  const servedRef = useRef(0);
  const answeredRef = useRef(false);
  const deadlineRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const advanceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const sessionIdRef = useRef<string | null>(null);
  const questionStartRef = useRef(0);

  const clearTimers = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    if (advanceRef.current) clearTimeout(advanceRef.current);
    advanceRef.current = null;
  };

  const revealFor = (q?: Question) => {
    if (!q) return "";
    return q.mode === "rapide"
      ? String((q as RapideQuestion).answer)
      : (q as GrilaQuestion).options[(q as GrilaQuestion).correctIndex]?.text ?? "";
  };

  const recordAnswer = (questionId: string, isCorrect: boolean, elapsedMs: number, opts: { answer?: string; selectedOptionId?: string }) => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    fetch(`/api/sessions/${sid}/answers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ questionId, isCorrect, elapsedMs, ...opts }),
    }).catch(() => {});
  };

  const finish = async () => {
    if (phase === "finished") return;
    clearTimers();
    answeredRef.current = true;
    setPhase("finished");
    setShowReview(true);

    const sid = sessionIdRef.current;
    sessionIdRef.current = null;
    if (sid) {
      fetch(`/api/sessions/${sid}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ correctCount: correctRef.current }),
      }).catch(() => {});
    }
    try {
      const res = await fetch("/api/train/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ correct: correctRef.current, total: servedRef.current }),
      });
      if (res.ok) {
        const data = await res.json();
        setStanding({ mine: data.today?.mine ?? null, rows: data.today?.rows ?? [] });
      }
    } catch {
      /* the score still counts locally even if the save failed */
    }
  };
  const finishRef = useRef(finish);
  finishRef.current = finish;

  const tick = () => {
    const left = deadlineRef.current - Date.now();
    setTimeLeft(Math.max(0, left));
    if (left <= 0) finishRef.current();
  };

  const nextQuestion = () => {
    const ni = idxRef.current + 1;
    if (ni >= queueRef.current.length || Date.now() >= deadlineRef.current) {
      finishRef.current();
      return;
    }
    idxRef.current = ni;
    setIdx(ni);
    answeredRef.current = false;
    setFeedback(null);
    setInputValue("");
    setSelectedOption(null);
    questionStartRef.current = Date.now();
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const submit = (isCorrect: boolean, opts?: { answer?: string; selectedOptionId?: string; skipped?: boolean }) => {
    if (answeredRef.current) return;
    answeredRef.current = true;
    const q = queueRef.current[idxRef.current];
    const elapsedMs = Math.max(0, Date.now() - questionStartRef.current);
    servedRef.current += 1;

    if (isCorrect) {
      correctRef.current += 1;
      setCorrect((c) => c + 1);
    } else {
      setWrong((w) => w + 1);
    }

    if (q) {
      recordAnswer(q.id, isCorrect, elapsedMs, opts);
      const myAnswer =
        opts?.selectedOptionId != null
          ? ((q as GrilaQuestion).options.find((o) => o.id === opts.selectedOptionId)?.text ?? "")
          : (opts?.answer ?? "");
      setReview((r) => [
        ...r,
        {
          id: q.id,
          prompt: q.prompt,
          myAnswer: opts?.skipped ? "—" : myAnswer || "—",
          correctAnswer: revealFor(q),
          isCorrect,
        },
      ]);
    }

    setFeedback({
      state: opts?.skipped ? "skip" : isCorrect ? "correct" : "wrong",
      reveal: revealFor(q),
    });
    // right answers flash quickly so the pace stays high; a miss lingers long
    // enough to actually read the reveal
    advanceRef.current = setTimeout(nextQuestion, isCorrect ? 550 : 1200);
  };

  // A bad question in the recap can be flagged right there: the API unpublishes
  // it so it stops showing up in games until an admin checks it.
  const reportQuestion = async (qid: string) => {
    if (reported.has(qid)) return;
    setReportErr("");
    try {
      const r = await fetch(`/api/questions/${qid}/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: "raportată din antrenament" }),
      });
      if (r.ok || r.status === 409) {
        setReported((prev) => new Set(prev).add(qid));
        return;
      }
      const d = await r.json().catch(() => ({}));
      setReportErr(d.error || "Nu am putut raporta întrebarea.");
    } catch {
      setReportErr("Eroare de rețea.");
    }
  };

  const startRun = async () => {
    setPhase("loading");
    setLoadError("");
    setIdx(0);
    idxRef.current = 0;
    setCorrect(0);
    setWrong(0);
    correctRef.current = 0;
    servedRef.current = 0;
    setReview([]);
    setShowReview(false);
    setReported(new Set());
    setReportErr("");
    setStanding(null);
    setFeedback(null);
    setInputValue("");
    setSelectedOption(null);
    try {
      const [g1, g2, r1] = await Promise.all([
        fetch(`/api/questions?mode=grila&count=20`).then((r) => r.json()),
        fetch(`/api/questions?mode=grila&count=20`).then((r) => r.json()),
        fetch(`/api/questions?mode=rapide&count=20`).then((r) => r.json()),
      ]);
      const seen = new Set<string>();
      const grila: Question[] = [...(g1.questions ?? []), ...(g2.questions ?? [])]
        .filter((q: GrilaQuestion) => (seen.has(q.id) ? false : (seen.add(q.id), true)))
        .slice(0, GRILA_WANTED)
        .map((q: GrilaQuestion) => ({ ...q, mode: "grila" as const }));
      const rapide: Question[] = (r1.questions ?? [])
        .filter((q: RapideQuestion) => (seen.has(q.id) ? false : (seen.add(q.id), true)))
        .slice(0, RAPIDE_WANTED)
        .map((q: RapideQuestion) => ({ ...q, mode: "rapide" as const }));

      const mixed = interleave(grila, rapide);
      if (mixed.length === 0) {
        setPhase("idle");
        setLoadError("Nu sunt întrebări disponibile momentan — încearcă mai târziu.");
        return;
      }
      queueRef.current = mixed;
      setQueue(mixed);

      // official session so the answers still feed PRC + question stats
      try {
        const sres = await fetch("/api/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "grila" }),
        });
        if (sres.ok) sessionIdRef.current = (await sres.json()).sessionId ?? null;
      } catch {
        sessionIdRef.current = null;
      }

      answeredRef.current = false;
      questionStartRef.current = Date.now();
      deadlineRef.current = Date.now() + DURATION_MS;
      setTimeLeft(DURATION_MS);
      setPhase("playing");
      clearTimers();
      timerRef.current = setInterval(tick, 100);
      setTimeout(() => inputRef.current?.focus(), 0);
    } catch {
      setPhase("idle");
      setLoadError("Nu am putut încărca întrebările. Verifică conexiunea.");
    }
  };

  const abandon = () => {
    const sid = sessionIdRef.current;
    if (sid) {
      fetch(`/api/sessions/${sid}/abandon`, { method: "POST" }).catch(() => {});
      sessionIdRef.current = null;
    }
    clearTimers();
    answeredRef.current = true;
    setPhase("idle");
    setShowReview(false);
  };

  useEffect(() => () => clearTimers(), []);

  // ---------- idle ----------
  if (phase === "idle" || phase === "loading") {
    return (
      <div className="w-full max-w-[720px] mx-auto flex flex-col gap-4 py-4">
        <a
          href="/"
          className="self-start text-[#8fb0ac] hover:text-[#9ec6c1] text-[0.85rem] font-cinzel border border-[#1e3a34] rounded-lg px-3 py-1.5 bg-[#0c1a17]"
        >
          ← Înapoi
        </a>
        <div className="bg-gradient-to-br from-[#122420] to-[#0c1a17] border-2 border-[#1e3a34] rounded-2xl shadow-2xl p-7 flex flex-col gap-4 text-center">
          <h1 className="!mb-0">🏋️ Antrenament</h1>
          <p className="text-[#cbdcda] text-[1.05rem] leading-relaxed">
            Ai <strong className="text-[#f0cf9a]">2 minute</strong> să răspunzi corect la cât mai multe
            întrebări.
            <br />
            Mix de <strong className="text-[#9ec6c1]">2 grilă</strong> și{" "}
            <strong className="text-[#9ec6c1]">1 rapidă</strong>, fără pauză.
          </p>
          {loadError && (
            <div className="text-red-400 text-[0.85rem] border border-red-500/40 bg-red-900/20 rounded-lg px-3 py-2">
              {loadError}
            </div>
          )}
          <button
            onClick={startRun}
            disabled={phase === "loading"}
            className="bg-gradient-to-br from-[#9ec6c1] to-[#6f9c99] border-2 border-[#9ec6c180] rounded-xl text-[#0c1a17] font-cinzel text-[1.15rem] tracking-widest p-4 hover:brightness-110 active:translate-y-px disabled:opacity-60 cursor-pointer"
          >
            {phase === "loading" ? "Se încarcă…" : "▶ Pornește cronometrul"}
          </button>
          <div className="text-[#75938f] text-[0.8rem]">
            Scorul tău zilei apare în <a href="/leaderboard?tab=train" className="underline hover:text-[#9ec6c1]">clasament</a>.
          </div>
        </div>
      </div>
    );
  }

  // ---------- finished ----------
  if (phase === "finished") {
    const served = servedRef.current;
    const score = correctRef.current;
    const accuracy = served ? Math.round((score / served) * 100) : 0;
    return (
      <>
        <div className="w-full max-w-[560px] mx-auto bg-gradient-to-br from-[#122420] to-[#0c1a17] border-2 border-[#1e3a34] rounded-2xl shadow-2xl p-7 flex flex-col gap-4 text-center">
          <h2 className="font-cinzel text-[#9ec6c1] text-[1.35rem]">⏱ Timpul a expirat</h2>
          <div className="font-cinzel text-[#f0cf9a] text-[3.4rem] leading-none">{score}</div>
          <div className="text-[#cbdcda] text-[0.95rem] leading-relaxed">
            răspunsuri corecte în 2 minute
            <br />
            <span className="text-[#8fb0ac] text-[0.85rem]">
              {served === 1 ? "1 întrebare jucată" : `${served} întrebări jucate`} · {accuracy}% precizie · {wrong}{wrong === 1 ? " greșită" : " greșite"}
            </span>
          </div>

          {standing?.mine && (
            <div className="rounded-xl border-2 border-[#8fd9a8]/40 bg-[#0f2a20] px-3 py-2.5">
              <div className="text-[0.65rem] uppercase tracking-[0.2em] text-[#8fd9a8]/85">locul tău azi</div>
              <div className="font-cinzel text-[1.5rem] text-[#b9f5cd]">#{standing.mine.rank}</div>
            </div>
          )}

          {standing && standing.rows.length > 0 && (
            <div className="text-left flex flex-col gap-1">
              <div className="text-[0.65rem] uppercase tracking-[0.18em] text-[#75938f] pb-0.5">Top azi</div>
              {standing.rows.slice(0, 5).map((r, i) => (
                <div key={r.id} className="flex items-center gap-2 text-[0.85rem]">
                  <span className="w-5 text-[#75938f]">{i + 1}.</span>
                  <span className="min-w-0 flex-1 truncate text-[#cbdcda]">{r.name}</span>
                  <span className="text-[#9ec6c1] font-cinzel">{r.correct}</span>
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-2.5 flex-wrap">
            <button
              onClick={startRun}
              className="flex-1 min-w-[130px] bg-gradient-to-br from-[#9ec6c1] to-[#6f9c99] border-2 border-[#9ec6c180] rounded-lg text-[#0c1a17] font-cinzel p-3 hover:brightness-110 cursor-pointer"
            >
              ▶ Încă o dată
            </button>
            <button
              onClick={() => setShowReview(true)}
              className="flex-1 min-w-[130px] bg-gradient-to-br from-[#2c514c] to-[#101f1c] border-2 border-[#4d7a76a0] rounded-lg text-[#e2eeeb] font-cinzel p-3 hover:brightness-125 cursor-pointer"
            >
              Recenzie ({review.length})
            </button>
            <a
              href="/leaderboard?tab=train"
              className="flex-1 min-w-[130px] text-center bg-gradient-to-br from-[#2c514c] to-[#101f1c] border-2 border-[#4d7a76a0] rounded-lg text-[#e2eeeb] font-cinzel p-3 hover:brightness-125"
            >
              👑 Clasament
            </a>
            <a
              href="/"
              className="flex-1 min-w-[130px] text-center bg-gradient-to-br from-[#101f1c] to-[#0c1a17] border-2 border-[#1e3a34] rounded-lg text-[#8fb0ac] font-cinzel p-3 hover:brightness-125"
            >
              ← Înapoi
            </a>
          </div>
        </div>

        {showReview && (
          <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
            <div className="bg-gradient-to-br from-[#122420] to-[#0c1a17] border-2 border-[#1e3a34] rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col">
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#1e3a3460]">
                <h3 className="font-cinzel text-[#9ec6c1] text-[0.95rem] tracking-widest">📋 Recenzia rundei</h3>
                <button onClick={() => setShowReview(false)} className="text-[#8fb0ac] hover:text-[#9ec6c1] cursor-pointer text-[1.1rem]" title="Închide">
                  ✕
                </button>
              </div>
              {reportErr && <div className="px-5 py-2 text-[0.75rem] text-red-400 border-b border-red-500/30 bg-red-900/20">{reportErr}</div>}
              <div className="overflow-y-auto p-4 flex flex-col gap-2">
                {review.length === 0 && <div className="text-[#75938f] text-[0.8rem] text-center p-4">Nicio întrebare jucată.</div>}
                {review.map((r, i) => (
                  <div
                    key={r.id + i}
                    className={`rounded-xl border-2 p-3 flex flex-col gap-1.5 ${r.isCorrect ? "bg-green-900/15 border-green-500/30" : "bg-red-900/15 border-red-500/30"}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[0.75rem] text-[#75938f]">#{i + 1}</span>
                      <span className="text-[0.85rem]">{r.isCorrect ? "✔" : "✖"}</span>
                    </div>
                    <div className="text-[0.9rem] text-[#cbdcda] leading-snug">
                      <PromptText text={r.prompt} />
                      {/* flag sits at the end of the question itself, not on the
                          far edge of the card */}
                      {reported.has(r.id) ? (
                        <span className="ml-2 align-middle text-[0.68rem] text-[#8fb0ac]">Raportată ✓</span>
                      ) : (
                        <button
                          onClick={() => void reportQuestion(r.id)}
                          className="ml-2 align-middle text-[0.68rem] text-red-400/90 border border-red-500/40 rounded px-1.5 py-0.5 hover:bg-red-900/30 cursor-pointer"
                          title="Raportează întrebarea — iese din joc până o verifică un editor"
                        >
                          ⚠ Raportează
                        </button>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.8rem]">
                      <span className={r.isCorrect ? "text-green-400" : "text-red-400"}>
                        Ai răspuns: <strong>{r.myAnswer}</strong>
                      </span>
                      {!r.isCorrect && (
                        <span className="text-[#9ec6c1]">Corect: <strong>{r.correctAnswer}</strong></span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  // ---------- playing ----------
  const q = queue[idx];
  const isGrila = q?.mode === "grila";
  const urgent = timeLeft <= 15_000;

  return (
    <div className="w-full max-w-[720px] mx-auto flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <button
          onClick={abandon}
          className="text-[#8fb0ac] hover:text-[#9ec6c1] text-[0.82rem] font-cinzel border border-[#1e3a34] rounded-lg px-3 py-1.5 bg-[#0c1a17] cursor-pointer"
        >
          ← Renunță
        </button>
        <div className="flex items-center gap-4">
          <span className="text-[0.75rem] text-[#75938f]">grilă + rapidă</span>
          <span className="font-cinzel text-[#8fd9a8] text-[1.05rem]">{correct} ✓</span>
          <span
            className={`font-cinzel text-[1.6rem] leading-none tabular-nums ${urgent ? "text-red-400" : "text-[#f0cf9a]"}`}
          >
            {mmss(timeLeft)}
          </span>
        </div>
      </div>

      <div className="h-1.5 bg-[#050d0b] rounded-[3px] overflow-hidden border border-[#1e3a3440]">
        <div
          className={`h-full transition-[width] duration-100 ${urgent ? "bg-red-500" : "bg-gradient-to-r from-[#6f9c99] to-[#9ec6c1]"}`}
          style={{ width: `${(timeLeft / DURATION_MS) * 100}%` }}
        />
      </div>

      <div className="bg-gradient-to-br from-[#122420] to-[#0c1a17] border-2 border-[#1e3a34] rounded-2xl shadow-2xl p-6 flex flex-col gap-4">
        <div className="flex items-center justify-between text-[0.7rem] uppercase tracking-wider text-[#75938f]">
          <span>{isGrila ? "🎯 grilă" : "⚡ rapidă"}</span>
          <span>nr. {idx + 1}</span>
        </div>

        <p className="font-cinzel text-[1.15rem] leading-relaxed min-h-[64px]">
          <PromptText text={q?.prompt ?? ""} />
        </p>

        {isGrila ? (
          <div className="grid grid-cols-1 gap-2">
            {(q as GrilaQuestion).options.map((opt, i) => {
              let cls = "bg-[#050d0b] border-2 border-[#1e3a34] hover:border-[#6f9c99] hover:bg-[#0c1a17]";
              if (feedback) {
                if (i === (q as GrilaQuestion).correctIndex)
                  cls = "bg-green-800/40 border-green-400 ring-2 ring-green-400/60 text-[#eafbf0] font-semibold";
                else if (i === selectedOption) cls = "bg-red-900/30 border-red-500/60 text-[#e2eeeb]";
                else cls = "bg-[#050d0b] border-[#16302b] opacity-60";
              }
              return (
                <button
                  key={opt.id}
                  onClick={() => {
                    if (feedback) return;
                    setSelectedOption(i);
                    const ok = i === (q as GrilaQuestion).correctIndex;
                    submit(ok, { selectedOptionId: opt.id, answer: opt.text });
                  }}
                  disabled={!!feedback}
                  className={`text-left rounded-lg px-3.5 py-3 text-[0.98rem] leading-snug transition-all cursor-pointer disabled:cursor-default ${cls}`}
                >
                  <span className="font-cinzel text-[#6f9c99] mr-2">{String.fromCharCode(65 + i)}.</span>
                  {opt.text}
                  {feedback && i === (q as GrilaQuestion).correctIndex && (
                    <span className="ml-2 align-middle text-[0.72rem] font-bold uppercase tracking-wider text-[#8ff0b0]">✔ corect</span>
                  )}
                </button>
              );
            })}
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <input
              ref={inputRef}
              type="text"
              inputMode="numeric"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && inputValue.trim() !== "" && !feedback) {
                  submit(parseInt(inputValue, 10) === (q as RapideQuestion).answer, { answer: inputValue });
                }
              }}
              disabled={!!feedback}
              placeholder="Răspuns numeric…"
              className="flex-1 bg-[#050d0b] border-2 border-[#1e3a34] rounded-lg text-[#9ec6c1] text-[1.35rem] text-center p-3 outline-none focus:border-[#6f9c99] disabled:opacity-50"
            />
            <button
              onClick={() => submit(parseInt(inputValue, 10) === (q as RapideQuestion).answer, { answer: inputValue })}
              disabled={!!feedback || inputValue.trim() === ""}
              className="bg-gradient-to-br from-[#6f9c99] to-[#2c514c] border-2 border-[#9ec6c160] rounded-lg text-[#e2eeeb] font-cinzel px-5 py-3 hover:brightness-110 disabled:opacity-40 cursor-pointer"
            >
              OK
            </button>
          </div>
        )}

        {feedback ? (
          <div
            className={`rounded-xl border-2 px-3 py-2 text-center ${
              feedback.state === "correct"
                ? "border-[#8ff0b0]/45 bg-[#08241a]/85"
                : "border-red-500/40 bg-red-900/20"
            }`}
          >
            <div className="text-[0.65rem] uppercase tracking-[0.2em] text-[#8ff0b0]/80">
              {feedback.state === "correct" ? "corect" : "răspunsul corect"}
            </div>
            <div className="font-cinzel text-[1.35rem] leading-snug break-words text-[#b9f5cd]">{feedback.reveal || "—"}</div>
          </div>
        ) : (
          <button
            onClick={() => submit(false, { skipped: true })}
            className="self-end text-[0.75rem] text-[#75938f] hover:text-[#9ec6c1] underline cursor-pointer"
          >
            sari peste →
          </button>
        )}
      </div>
    </div>
  );
}
