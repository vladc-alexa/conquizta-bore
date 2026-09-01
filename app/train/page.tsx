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
  const [questions, setQuestions] = useState<(RapideQuestion | GrilaQuestion)[]>([]);
  const [idx, setIdx] = useState(0);
  const [correct, setCorrect] = useState(0);
  const [wrong, setWrong] = useState(0);
  const [timeouts, setTimeouts] = useState(0);
  const [feedback, setFeedback] = useState<{ state: "correct" | "wrong" | "timeout"; reveal: string } | null>(null);
  const [timeLeft, setTimeLeft] = useState(TIMER_SECONDS);
  const [inputValue, setInputValue] = useState("");
  const [selectedOption, setSelectedOption] = useState<number | null>(null);

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

  const recordAnswer = (questionId: string, isCorrect: boolean, opts: { answer?: string; selectedOptionId?: string }) => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    const elapsedMs = Math.max(0, Date.now() - questionStartRef.current);
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

  const handleTimeout = () => {
    if (answeredRef.current) return;
    answeredRef.current = true;
    clearTimer();
    setTimeLeft(0);
    setTimeouts((t) => t + 1);
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
    const q = questionsRef.current[idxRef.current];
    if (isCorrect) {
      setCorrect((c) => c + 1);
      correctRef.current += 1;
    } else setWrong((w) => w + 1);
    if (q) recordAnswer(q.id, isCorrect, opts);
    setFeedback({ state: isCorrect ? "correct" : "wrong", reveal: revealAnswer() });
    setTimeout(nextQuestion, 1400);
  };

  const startGame = async (m: Mode) => {
    if (!m) return;
    setMode(m);
    modeRef.current = m;
    setPhase("loading");
    setIdx(0);
    idxRef.current = 0;
    setCorrect(0);
    correctRef.current = 0;
    setWrong(0);
    setTimeouts(0);
    try {
      const res = await fetch(`/api/questions?mode=${m}&count=${QUESTION_COUNT}`);
      const data = await res.json();
      const qs = data.questions ?? [];
      if (qs.length === 0) {
        setMode(null);
        modeRef.current = null;
        setPhase("idle");
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

  // keep the numeric input focused across questions
  useEffect(() => {
    if (phase === "playing" && mode === "rapide") {
      const t = setTimeout(() => inputRef.current?.focus(), 80);
      return () => clearTimeout(t);
    }
  }, [idx, phase, mode]);

  // ---------- mode selection ----------
  if (mode === null) {
    return (
      <div className="w-full max-w-3xl mx-auto flex flex-col gap-5 py-6">
        <h1 className="text-center !mb-0">Antrenament</h1>
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
      <div className="bg-gradient-to-br from-[#3d2510] to-[#2a1608] border-2 border-[#7a4e22] rounded-2xl shadow-2xl w-full max-w-[520px] mx-auto p-7 flex flex-col gap-4 text-center">
        <h2 className="font-cinzel text-[#f5c97a] text-[1.4rem]">🏆 Terminat!</h2>
        <div className="text-[0.95rem] leading-[1.9] text-[#d0c090]">
          Corecte: <strong className="text-[#f5c97a]">{correct} / {total}</strong> ({accuracy}%)<br />
          Greșite: <strong>{wrong}</strong><br />
          Timp expirat: <strong>{timeouts}</strong>
        </div>
        <div className="flex gap-2.5">
          <button
            onClick={() => startGame(mode)}
            className="flex-1 bg-gradient-to-br from-[#c87030] to-[#7a4010] border-2 border-[#f5c97a60] rounded-lg text-[#f5e8c0] font-cinzel p-3 hover:brightness-110 cursor-pointer"
          >
            Încă o dată
          </button>
          <button
            onClick={() => setMode(null)}
            className="flex-1 bg-gradient-to-br from-[#7a4010] to-[#3d2010] border-2 border-[#c88040a0] rounded-lg text-[#f5e8c0] font-cinzel p-3 hover:brightness-125 cursor-pointer"
          >
            Schimbă modul
          </button>
        </div>
      </div>
    );
  }

  // ---------- playing ----------
  const q = questions[idx];
  const isGrila = mode === "grila";
  const pct = (timeLeft / TIMER_SECONDS) * 100;

  return (
    <div className="w-full max-w-[620px] mx-auto flex flex-col gap-4">
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
                : feedback.state === "wrong"
                ? "bg-red-900/25 border-red-500/40"
                : "bg-yellow-900/25 border-yellow-500/40"
            }`}
          >
            <div className="text-2xl">{feedback.state === "correct" ? "✔" : feedback.state === "wrong" ? "✖" : "⏱"}</div>
            <div className="font-cinzel">
              {feedback.state === "correct" ? "Corect!" : feedback.state === "wrong" ? "Greșit!" : "Timp expirat!"}
            </div>
            <div className="text-[0.85rem] text-[#d0b888]">Răspuns corect: <strong className="text-[#f5c97a]">{feedback.reveal}</strong></div>
          </div>
        )}
      </div>
    </div>
  );
}
