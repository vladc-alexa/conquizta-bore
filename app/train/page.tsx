"use client";

import { useEffect, useRef, useState } from "react";

type Mode = "rapide" | "grila" | null;

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

const TIMER_SECONDS = 10;
const QUESTION_COUNT = 10;

export default function TrainPage() {
  const [mode, setMode] = useState<Mode>(null);
  const [phase, setPhase] = useState<"idle" | "loading" | "playing" | "finished">("idle");
  const [loadError, setLoadError] = useState("");
  const [questions, setQuestions] = useState<(RapideQuestion | GrilaQuestion)[]>([]);
  const [idx, setIdx] = useState(0);
  const [correct, setCorrect] = useState(0);
  const [wrong, setWrong] = useState(0);
  const [timeouts, setTimeouts] = useState(0);
  const [feedback, setFeedback] = useState<{ state: "correct" | "wrong" | "timeout"; reveal: string; elapsed?: number } | null>(null);
  const [timeLeft, setTimeLeft] = useState(TIMER_SECONDS);
  const [inputValue, setInputValue] = useState("");
  const [selectedOption, setSelectedOption] = useState<number | null>(null);

  interface ReviewItem {
    id: string;
    prompt: string;
    myAnswer: string;
    correctAnswer: string;
    isCorrect: boolean;
    timeout: boolean;
  }
  const [review, setReview] = useState<ReviewItem[]>([]);
  const [reported, setReported] = useState<Set<string>>(new Set());
  const [showReview, setShowReview] = useState(false);
  const [canEdit, setCanEdit] = useState(false);

  // refs mirror the state for timer callbacks (no stale closures)
  const questionsRef = useRef<(RapideQuestion | GrilaQuestion)[]>([]);
  const idxRef = useRef(0);
  const modeRef = useRef<Mode>(null);
  const deadlineRef = useRef(0);
  const answeredRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const sessionIdRef = useRef<string | null>(null);
  const questionStartRef = useRef(0);

  const recordAnswer = (questionId: string, isCorrect: boolean, elapsedMs: number, opts: { answer?: string; selectedOptionId?: string }) => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    fetch(`/api/sessions/${sid}/answers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ questionId, isCorrect, elapsedMs, ...opts }),
    }).catch(() => {});
  };

  const completeSession = () => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    sessionIdRef.current = null;
    fetch(`/api/sessions/${sid}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ correctCount: correctRef.current }),
    }).catch(() => {});
  };
  const correctRef = useRef(0);

  const clearTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  };

  const revealAnswer = (): string => {
    const q = questionsRef.current[idxRef.current];
    if (!q) return "";
    if (modeRef.current === "rapide") return String((q as RapideQuestion).answer);
    const g = q as GrilaQuestion;
    return g.options[g.correctIndex].text;
  };

  const nextQuestion = () => {
    if (idxRef.current + 1 >= questionsRef.current.length) {
      clearTimer();
      completeSession();
      setPhase("finished");
      return;
    }
    const ni = idxRef.current + 1;
    idxRef.current = ni;
    setIdx(ni);
    answeredRef.current = false;
    setFeedback(null);
    setTimeLeft(TIMER_SECONDS);
    setInputValue("");
    setSelectedOption(null);
    questionStartRef.current = Date.now();
    deadlineRef.current = Date.now() + TIMER_SECONDS * 1000;
    clearTimer();
    timerRef.current = setInterval(tick, 100);
  };

  const pushReview = (q: RapideQuestion | GrilaQuestion, myAnswer: string, isCorrect: boolean, timeout: boolean) => {
    setReview((r) => [
      ...r,
      {
        id: q.id,
        prompt: q.prompt,
        myAnswer: timeout ? "—" : myAnswer || "—",
        correctAnswer: revealAnswer(),
        isCorrect,
        timeout,
      },
    ]);
  };

  const reportQuestion = async (qid: string) => {
    if (reported.has(qid)) return;
    try {
      const res = await fetch(`/api/questions/${qid}/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: "raportată din recenzie" }),
      });
      if (res.ok) {
        setReported((prev) => new Set(prev).add(qid));
      }
    } catch {
      /* ignore */
    }
  };

  const handleTimeout = () => {
    if (answeredRef.current) return;
    answeredRef.current = true;
    clearTimer();
    setTimeLeft(0);
    setTimeouts((t) => t + 1);
    const q = questionsRef.current[idxRef.current];
    if (q) pushReview(q, "", false, true);
    setFeedback({ state: "timeout", reveal: revealAnswer() });
    setTimeout(nextQuestion, 1400);
  };

  const tick = () => {
    const left = (deadlineRef.current - Date.now()) / 1000;
    if (left <= 0) {
      handleTimeout();
    } else {
      setTimeLeft(left);
    }
  };

  const handleAnswer = (isCorrect: boolean, opts?: { answer?: string; selectedOptionId?: string }) => {
    if (answeredRef.current) return;
    answeredRef.current = true;
    clearTimer();
    const elapsedMs = Math.max(0, Date.now() - questionStartRef.current);
    const q = questionsRef.current[idxRef.current];
    if (isCorrect) {
      setCorrect((c) => c + 1);
      correctRef.current += 1;
    } else setWrong((w) => w + 1);
    if (q) {
      recordAnswer(q.id, isCorrect, elapsedMs, opts);
      const myAnswer =
        opts?.selectedOptionId != null
          ? ((q as GrilaQuestion).options.find((o) => o.id === opts.selectedOptionId)?.text ?? "")
          : (opts?.answer ?? "");
      pushReview(q, myAnswer, isCorrect, false);
    }
    setFeedback({
      state: isCorrect ? "correct" : "wrong",
      reveal: revealAnswer(),
      elapsed: modeRef.current === "rapide" ? elapsedMs : undefined,
    });
    setTimeout(nextQuestion, 1400);
  };

  const startGame = async (m: Mode) => {
    if (!m) return;
    setMode(m);
    modeRef.current = m;
    setPhase("loading");
    setLoadError("");
    setIdx(0);
    idxRef.current = 0;
    setCorrect(0);
    correctRef.current = 0;
    setWrong(0);
    setTimeouts(0);
    setReview([]);
    setReported(new Set());
    setShowReview(false);
    try {
      const res = await fetch(`/api/questions?mode=${m}&count=${QUESTION_COUNT}`);
      const data = await res.json();
      const qs = data.questions ?? [];
      if (qs.length === 0) {
        setMode(null);
        modeRef.current = null;
        setPhase("idle");
        setLoadError("Nu sunt întrebări disponibile momentan — încearcă mai târziu.");
        return;
      }
      // start an official session (records answers toward PRC)
      try {
        const sres = await fetch("/api/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: m }),
        });
        if (sres.ok) {
          const sdata = await sres.json();
          sessionIdRef.current = sdata.sessionId ?? null;
        }
      } catch {
        sessionIdRef.current = null;
      }
      setQuestions(qs);
      questionsRef.current = qs;
      setPhase("playing");
      answeredRef.current = false;
      setFeedback(null);
      setTimeLeft(TIMER_SECONDS);
      setInputValue("");
      setSelectedOption(null);
      questionStartRef.current = Date.now();
      deadlineRef.current = Date.now() + TIMER_SECONDS * 1000;
      clearTimer();
      timerRef.current = setInterval(tick, 100);
      setTimeout(() => inputRef.current?.focus(), 0);
    } catch {
      setMode(null);
      modeRef.current = null;
      setPhase("idle");
    }
  };

  useEffect(() => () => clearTimer(), []);

  // editors/admins can jump straight from the review into editing the question
  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setCanEdit(!!(d.isAdmin || d.canEditQuestions)))
      .catch(() => {});
  }, []);

  // auto-open the review modal when a session finishes
  useEffect(() => {
    if (phase === "finished") setShowReview(true);
  }, [phase]);

  // keep the numeric input focused across questions
  useEffect(() => {
    if (phase === "playing" && mode === "rapide") {
      const t = setTimeout(() => inputRef.current?.focus(), 80);
      return () => clearTimeout(t);
    }
  }, [idx, phase, mode]);

  const backToLobby = () => {
    const sid = sessionIdRef.current;
    if (sid) {
      fetch(`/api/sessions/${sid}/abandon`, { method: "POST" }).catch(() => {});
      sessionIdRef.current = null;
    }
    clearTimer();
    answeredRef.current = true;
    setMode(null);
    modeRef.current = null;
    setPhase("idle");
  };

  // ---------- mode selection ----------
  if (mode === null) {
    return (
      <div className="w-full max-w-3xl mx-auto flex flex-col gap-5 py-6">
        <h1 className="text-center !mb-0">Antrenament</h1>
        {loadError && (
          <div className="text-red-400 text-[0.85rem] text-center border border-red-500/40 bg-red-900/20 rounded-lg px-3 py-2">
            {loadError}
          </div>
        )}
        <div className="grid sm:grid-cols-2 gap-4">
          <button
            onClick={() => startGame("rapide")}
            className="bg-gradient-to-br from-[#3d2510] to-[#2a1608] border-2 border-[#7a4e22] rounded-2xl shadow-2xl p-6 flex flex-col gap-2 text-left hover:border-[#c87030] hover:brightness-110 cursor-pointer transition-all"
          >
            <span className="text-[2rem]">⚡</span>
            <span className="font-cinzel text-[#f5c97a] text-[1.1rem] tracking-wider">Train Întrebări Rapide</span>
            <span className="text-[#c8a070] text-[0.8rem]">Scrie răspunsul numeric (poate fi negativ). {TIMER_SECONDS}s / întrebare.</span>
          </button>
          <button
            onClick={() => startGame("grila")}
            className="bg-gradient-to-br from-[#3d2510] to-[#2a1608] border-2 border-[#7a4e22] rounded-2xl shadow-2xl p-6 flex flex-col gap-2 text-left hover:border-[#c87030] hover:brightness-110 cursor-pointer transition-all"
          >
            <span className="text-[2rem]">🎯</span>
            <span className="font-cinzel text-[#f5c97a] text-[1.1rem] tracking-wider">Train Întrebări Grilă</span>
            <span className="text-[#c8a070] text-[0.8rem]">Alege una din cele 4 variante. {TIMER_SECONDS}s / întrebare.</span>
          </button>
        </div>
      </div>
    );
  }

  if (phase === "loading") {
    return <div className="text-center font-cinzel text-[#f5c97a] py-16">Se încarcă întrebările…</div>;
  }

  if (phase === "finished") {
    const total = correct + wrong + timeouts;
    const accuracy = total ? Math.round((correct / total) * 100) : 0;
    return (
      <>
      <div className="bg-gradient-to-br from-[#3d2510] to-[#2a1608] border-2 border-[#7a4e22] rounded-2xl shadow-2xl w-full max-w-[520px] mx-auto p-7 flex flex-col gap-4 text-center">
        <h2 className="font-cinzel text-[#f5c97a] text-[1.4rem]">🏆 Terminat!</h2>
        <div className="text-[0.95rem] leading-[1.9] text-[#d0c090]">
          Corecte: <strong className="text-[#f5c97a]">{correct} / {total}</strong> ({accuracy}%)<br />
          Greșite: <strong>{wrong}</strong><br />
          Timp expirat: <strong>{timeouts}</strong>
        </div>
        <div className="flex gap-2.5 flex-wrap">
          <button
            onClick={() => startGame(mode)}
            className="flex-1 min-w-[130px] bg-gradient-to-br from-[#c87030] to-[#7a4010] border-2 border-[#f5c97a60] rounded-lg text-[#f5e8c0] font-cinzel p-3 hover:brightness-110 cursor-pointer"
          >
            Încă o dată
          </button>
          <button
            onClick={() => setShowReview(true)}
            className="flex-1 min-w-[130px] bg-gradient-to-br from-[#7a4010] to-[#3d2010] border-2 border-[#c88040a0] rounded-lg text-[#f5e8c0] font-cinzel p-3 hover:brightness-125 cursor-pointer"
          >
            Recenzie ({review.length})
          </button>
          <button
            onClick={() => setMode(null)}
            className="flex-1 min-w-[130px] bg-gradient-to-br from-[#3d2010] to-[#2a1608] border-2 border-[#7a4e22] rounded-lg text-[#c8a070] font-cinzel p-3 hover:brightness-125 cursor-pointer"
          >
            Schimbă modul
          </button>
          <button
            onClick={() => (window.location.href = "/")}
            className="flex-1 min-w-[130px] bg-gradient-to-br from-[#7a4010] to-[#3d2010] border-2 border-[#c88040a0] rounded-lg text-[#f5e8c0] font-cinzel p-3 hover:brightness-125 cursor-pointer"
          >
            ← Înapoi
          </button>
        </div>
      </div>

      {/* review modal */}
      {showReview && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="bg-gradient-to-br from-[#3d2510] to-[#2a1608] border-2 border-[#7a4e22] rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#7a4e2260]">
              <h3 className="font-cinzel text-[#f5c97a] text-[0.95rem] tracking-widest">📋 Recenzia sesiunii</h3>
              <button onClick={() => setShowReview(false)} className="text-[#c8a070] hover:text-[#f5c97a] cursor-pointer text-[1.1rem]" title="Închide">
                ✕
              </button>
            </div>
            <div className="overflow-y-auto p-4 flex flex-col gap-2">
              {review.length === 0 && (
                <div className="text-[#a07848] text-[0.8rem] text-center p-4">Nicio întrebare înregistrată.</div>
              )}
              {review.map((r, i) => (
                <div
                  key={r.id + i}
                  className={`rounded-xl border-2 p-3 flex flex-col gap-1.5 ${r.isCorrect ? "bg-green-900/15 border-green-500/30" : "bg-red-900/15 border-red-500/30"}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[0.75rem] text-[#a07848]">
                      #{i + 1} · <span className="font-mono text-[#c8a070]">ID {r.id.slice(0, 8)}</span>
                    </span>
                    <span className="text-[0.85rem]">{r.isCorrect ? "✔" : r.timeout ? "⏱" : "✖"}</span>
                  </div>
                  <div className="text-[0.9rem] text-[#e8d8b0] leading-snug">{r.prompt}</div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.8rem]">
                    <span className={r.isCorrect ? "text-green-400" : "text-red-400"}>
                      Ai răspuns: <strong>{r.myAnswer}</strong>
                    </span>
                    {!r.isCorrect && (
                      <span className="text-[#f5c97a]">
                        Corect: <strong>{r.correctAnswer}</strong>
                      </span>
                    )}
                    <div className="ml-auto flex items-center gap-2">
                      {canEdit && (
                        <a
                          href={`/admin?search=${r.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[0.7rem] text-[#c8a070] border border-[#7a4e22] rounded px-2 py-0.5 hover:bg-[#3d2510]"
                          title="Editează întrebarea (se deschide în filă nouă)"
                        >
                          ✏️ Editează
                        </a>
                      )}
                      {reported.has(r.id) ? (
                        <span className="text-[#c8a070] text-[0.7rem]">Raportată ✓</span>
                      ) : (
                        <button
                          onClick={() => reportQuestion(r.id)}
                          className="text-[0.7rem] text-red-400/90 border border-red-500/40 rounded px-2 py-0.5 hover:bg-red-900/30 cursor-pointer"
                        >
                          Raportează
                        </button>
                      )}
                    </div>
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
  const q = questions[idx];
  const isGrila = mode === "grila";
  const pct = (timeLeft / TIMER_SECONDS) * 100;

  return (
    <div className="w-full max-w-[620px] mx-auto flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <button
          onClick={backToLobby}
          className="text-[#c8a070] hover:text-[#f5c97a] text-[0.85rem] font-cinzel border border-[#7a4e22] rounded-lg px-3 py-1.5 bg-[#2a1608] cursor-pointer"
        >
          ← Înapoi
        </button>
        <span className="text-[0.7rem] text-[#a07848]">{mode === "rapide" ? "Întrebări rapide" : "Întrebări grilă"}</span>
      </div>

      {/* progress + timer */}
      <div className="flex items-center gap-3 text-[0.8rem] text-[#c8a070]">
        <span className="min-w-[70px]">Întrebarea {idx + 1} / {questions.length}</span>
        <div className="flex-1 h-1.5 bg-[#1a0e05] rounded-[3px] overflow-hidden border border-[#7a4e2240]">
          <div className="h-full bg-gradient-to-r from-[#c87030] to-[#f5c97a] transition-all duration-100" style={{ width: `${((idx + (feedback ? 1 : 0)) / questions.length) * 100}%` }}></div>
        </div>
        <span className="text-[#f5c97a] font-bold">{correct}✓ {wrong}✗</span>
      </div>

      {/* question card */}
      <div className="bg-gradient-to-br from-[#3d2510] to-[#2a1608] border-2 border-[#7a4e22] rounded-2xl shadow-2xl p-7 flex flex-col gap-5">
        <div className="flex items-center gap-3">
          <div
            className={`w-[52px] h-[52px] rounded-full border-2 flex items-center justify-center font-cinzel text-[1.1rem] shrink-0 ${
              timeLeft <= 3 && !feedback ? "border-red-500 text-red-400" : "border-[#f5c97a] text-[#f5c97a]"
            }`}
          >
            {Math.ceil(timeLeft)}
          </div>
          <div className="flex-1 h-2 bg-[#1a0e05] rounded overflow-hidden border border-[#7a4e2240]">
            <div
              className={`h-full transition-all duration-100 ${timeLeft <= 3 ? "bg-red-500" : "bg-gradient-to-r from-[#c87030] to-[#f5c97a]"}`}
              style={{ width: `${pct}%` }}
            ></div>
          </div>
        </div>

        <p className="font-cinzel text-[1.05rem] leading-relaxed min-h-[60px]">{q?.prompt}</p>

        {!isGrila && (q as RapideQuestion).responseType && (
          <div className="self-start text-[0.7rem] text-[#2a1608] bg-[#c87030]/90 rounded-full px-2.5 py-1 font-bold tracking-wide">
            Răspuns: {(q as RapideQuestion).responseType}
          </div>
        )}

        {isGrila ? (
          <div className="grid grid-cols-1 gap-2.5">
            {(q as GrilaQuestion).options.map((opt, i) => {
              let cls = "bg-[#1a0e05] border-2 border-[#7a4e22] hover:border-[#c87030] hover:bg-[#2a1608]";
              if (feedback) {
                const isCorrectOpt = i === (q as GrilaQuestion).correctIndex;
                const isSelected = i === selectedOption;
                if (isCorrectOpt) cls = "bg-green-900/30 border-green-500/60 text-[#f5e8c0]";
                else if (isSelected) cls = "bg-red-900/30 border-red-500/60 text-[#f5e8c0]";
                else cls = "bg-[#1a0e05] border-[#4a3a20] opacity-60";
              }
              return (
                <button
                  key={opt.id}
                  disabled={!!feedback}
                  onClick={() => {
                    setSelectedOption(i);
                    handleAnswer(i === (q as GrilaQuestion).correctIndex, { selectedOptionId: opt.id });
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
              ref={inputRef}
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={inputValue}
              onChange={(e) => {
                const v = e.target.value.replace(/[^0-9-]/g, "");
                if (/^-?\d*$/.test(v)) setInputValue(v);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !feedback && inputValue !== "") {
                  handleAnswer(parseInt(inputValue, 10) === (q as RapideQuestion).answer, { answer: inputValue });
                }
              }}
              disabled={!!feedback}
              placeholder="Răspuns numeric…"
              className="flex-1 bg-[#1a0e05] border-2 border-[#7a4e22] rounded-lg text-[#f5c97a] text-[1.3rem] text-center p-2.5 outline-none focus:border-[#c87030] disabled:opacity-50"
            />
            <button
              onClick={() => handleAnswer(parseInt(inputValue, 10) === (q as RapideQuestion).answer, { answer: inputValue })}
              disabled={!!feedback || inputValue === ""}
              className="bg-gradient-to-br from-[#c87030] to-[#7a4010] border-2 border-[#f5c97a60] rounded-lg text-[#f5e8c0] font-cinzel px-4 hover:brightness-110 disabled:opacity-40 cursor-pointer"
            >
              OK
            </button>
          </div>
        )}

        {feedback && (
          <div
            className={`rounded-xl p-3.5 text-center border-2 ${
              feedback.state === "correct"
                ? "bg-green-900/25 border-green-500/40"
                : feedback.state === "wrong" && mode === "rapide"
                ? "bg-amber-900/25 border-amber-500/40"
                : feedback.state === "wrong"
                ? "bg-red-900/25 border-red-500/40"
                : "bg-yellow-900/25 border-yellow-500/40"
            }`}
          >
            <div className="text-2xl">
              {feedback.state === "correct"
                ? "✔"
                : feedback.state === "wrong" && mode === "rapide"
                ? "🎯"
                : feedback.state === "wrong"
                ? "✖"
                : "⏱"}
            </div>
            {feedback.state !== "wrong" || mode !== "rapide" ? (
              <div className="font-cinzel">
                {feedback.state === "correct" ? "Corect!" : feedback.state === "wrong" ? "Greșit!" : "Timp expirat!"}
              </div>
            ) : null}
            <div className="text-[0.85rem] text-[#d0b888]">
              Răspuns corect: <strong className="text-[#f5c97a]">{feedback.reveal}</strong>
              {feedback.elapsed != null && (
                <span className="ml-3">Timp: <strong className="text-[#f5c97a]">{(feedback.elapsed / 1000).toFixed(3).replace(".", ",")}s</strong></span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
