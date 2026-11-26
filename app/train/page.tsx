"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { LanguageSwitcher, useI18n } from "@/lib/i18n";
import { InviteToast, LobbySeat, MatchLobby } from "@/components/MatchLobby";
import { stoneSound } from "@/lib/sound";

type Mode = "rapide" | "grila" | null;

interface RapideQuestion {
  id: string;
  category?: string;
  prompt: string;
  answer: number;
}

interface GrilaQuestion {
  id: string;
  category?: string;
  difficulty?: number;
  prompt: string;
  options: string[];
  correctIndex: number;
}

const TIMER_SECONDS = 10;

function TrainContent() {
  const { lang, t } = useI18n();
  const searchParams = useSearchParams();
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
  const [errorMsg, setErrorMsg] = useState("");

  // Bank metadata & filters
  const [mcCount, setMcCount] = useState(1500);
  const [numCount, setNumCount] = useState(160);
  const [categories, setCategories] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [questionCount, setQuestionCount] = useState(10);
  const [botDiff, setBotDiff] = useState<"easy" | "medium" | "hard">("medium");
  const [roomSeats, setRoomSeats] = useState<LobbySeat[]>([]);
  const [rivalScores, setRivalScores] = useState<Record<string, number>>({});
  const initialRoom = searchParams.get("room");

  const questionsRef = useRef<(RapideQuestion | GrilaQuestion)[]>([]);
  const idxRef = useRef(0);
  const modeRef = useRef<Mode>(null);
  const deadlineRef = useRef(0);
  const answeredRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const autoStartedRef = useRef(false);

  const clearTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  };

  useEffect(() => {
    setSelectedCategory("all");
    fetch(`/api/questions?meta=1&lang=${lang}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        if (typeof d.mcCount === "number") setMcCount(d.mcCount);
        if (typeof d.numCount === "number") setNumCount(d.numCount);
        if (Array.isArray(d.mcCategories)) setCategories(d.mcCategories);
      })
      .catch(() => {});
  }, [lang]);

  const revealAnswer = (): string => {
    const q = questionsRef.current[idxRef.current];
    if (!q) return "";
    if (modeRef.current === "rapide") return String((q as RapideQuestion).answer);
    const g = q as GrilaQuestion;
    return g.options[g.correctIndex];
  };

  const nextQuestion = () => {
    if (idxRef.current + 1 >= questionsRef.current.length) {
      clearTimer();
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
    deadlineRef.current = Date.now() + TIMER_SECONDS * 1000;
    clearTimer();
    timerRef.current = setInterval(tick, 100);
    setTimeout(() => inputRef.current?.focus(), 20);
  };

  const handleTimeout = () => {
    if (answeredRef.current) return;
    answeredRef.current = true;
    clearTimer();
    setTimeLeft(0);
    setTimeouts((x) => x + 1);
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

  const handleAnswer = (isCorrect: boolean) => {
    if (answeredRef.current) return;
    answeredRef.current = true;
    clearTimer();
    if (isCorrect) {
      setCorrect((c) => c + 1);
      stoneSound.climbStep(correct + 1);
    } else {
      setWrong((w) => w + 1);
      stoneSound.shieldCrack();
    }
    if (roomSeats.length > 1) {
      setRivalScores((prev) => {
        const next = { ...prev };
        for (const s of roomSeats.slice(1)) {
          const acc = s.botDifficulty === "easy" ? 0.48 : s.botDifficulty === "hard" ? 0.82 : 0.66;
          if (Math.random() < acc) next[s.userId] = (next[s.userId] ?? 0) + 1;
        }
        return next;
      });
    }
    setFeedback({ state: isCorrect ? "correct" : "wrong", reveal: revealAnswer() });
    setTimeout(nextQuestion, 1400);
  };

  const startGame = async (m: Mode) => {
    if (!m) return;
    setErrorMsg("");
    setMode(m);
    modeRef.current = m;
    setPhase("loading");
    setIdx(0);
    idxRef.current = 0;
    setCorrect(0);
    setWrong(0);
    setTimeouts(0);
    setRivalScores({});
    try {
      const catParam =
        m === "grila" && selectedCategory !== "all"
          ? `&category=${encodeURIComponent(selectedCategory)}`
          : "";
      const res = await fetch(`/api/questions?mode=${m}&count=${questionCount}&lang=${lang}${catParam}`);
      const data = await res.json();
      const qs = data.questions ?? [];
      if (qs.length === 0) {
        setMode(null);
        modeRef.current = null;
        setPhase("idle");
        setErrorMsg(t("trainNoQuestions"));
        return;
      }
      setQuestions(qs);
      questionsRef.current = qs;
      setPhase("playing");
      answeredRef.current = false;
      setFeedback(null);
      setTimeLeft(TIMER_SECONDS);
      setInputValue("");
      setSelectedOption(null);
      deadlineRef.current = Date.now() + TIMER_SECONDS * 1000;
      clearTimer();
      timerRef.current = setInterval(tick, 100);
      setTimeout(() => inputRef.current?.focus(), 0);
    } catch {
      setMode(null);
      modeRef.current = null;
      setPhase("idle");
      setErrorMsg(t("loginNetError"));
    }
  };

  useEffect(() => {
    if (autoStartedRef.current) return;
    const qp = searchParams.get("mode");
    if (qp === "grila" || qp === "rapide") {
      autoStartedRef.current = true;
      startGame(qp);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  useEffect(() => {
    if (phase !== "playing" || mode !== "grila" || feedback) return;
    const onKey = (e: KeyboardEvent) => {
      const map: Record<string, number> = { "1": 0, "2": 1, "3": 2, "4": 3, a: 0, b: 1, c: 2, d: 3 };
      const picked = map[e.key.toLowerCase()];
      const q = questionsRef.current[idxRef.current] as GrilaQuestion | undefined;
      if (picked !== undefined && q && picked < q.options.length) {
        setSelectedOption(picked);
        handleAnswer(picked === q.correctIndex);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, mode, feedback]);

  useEffect(() => () => clearTimer(), []);

  return (
    <div className="arena-backdrop min-h-screen w-full px-4 py-6 flex flex-col items-center">
      <InviteToast />

      <header className="w-full max-w-4xl flex items-center justify-between gap-3 mb-6">
        <Link
          href="/"
          className="royal-panel hover:border-[#f5cd71] rounded-xl px-4 py-2 text-xs font-cinzel font-bold tracking-wider text-[#f7e1b0] hover:text-white transition-all"
        >
          ← {t("trainBackHome")}
        </Link>
        <div className="flex items-center gap-2.5">
          <span className="hidden sm:inline-flex items-center gap-1.5 royal-panel rounded-xl px-3 py-1.5 text-xs font-cinzel text-[#ffd977]">
            📚 {t("trainBankBadge")}: <strong>{mcCount + numCount}</strong>
          </span>
          <LanguageSwitcher />
        </div>
      </header>

      {mode === null && (
        <div className="w-full max-w-4xl flex flex-col gap-6">
          <div className="text-center">
            <h1 className="font-cinzel font-extrabold text-3xl sm:text-4xl tracking-[0.14em] gold-title">
              {t("trainTitle")}
            </h1>
            <div className="crimson-ribbon inline-block mt-2 px-6 py-1 text-xs font-cinzel tracking-widest text-[#ffefc8]">
              {t("trainSubtitle")}
            </div>
          </div>

          <div className="royal-panel rounded-2xl p-4 flex flex-wrap items-center justify-between gap-4">
            <label className="flex items-center gap-2.5 text-xs font-cinzel text-[#e6c98e] flex-1 min-w-[220px]">
              <span className="uppercase tracking-wider shrink-0">{t("trainCategoryLabel")}:</span>
              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className="flex-1 bg-[#0e0b14] border border-[#9f702b] rounded-lg px-3 py-2 text-xs font-sans text-[#fff0cc] outline-none focus:border-[#f5cd71]"
              >
                <option value="all">
                  {t("trainAllCategories")} ({mcCount})
                </option>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>

            <div className="flex items-center gap-2 text-xs font-cinzel text-[#e6c98e]">
              <span className="uppercase tracking-wider">{t("trainCountLabel")}:</span>
              {[10, 15, 20].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setQuestionCount(n)}
                  className={`px-3 py-1.5 rounded-lg border font-bold cursor-pointer transition-all ${
                    questionCount === n
                      ? "btn-crimson border-[#f5cd71]"
                      : "bg-[#120e1a] border-[#7a5828] text-[#dfc99e] hover:border-[#d4a147]"
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          {errorMsg && (
            <div className="text-red-300 text-xs bg-red-950/70 border border-red-500/50 rounded-xl p-3 text-center">
              {errorMsg}
            </div>
          )}

          <MatchLobby
            gameType="train"
            maxSeats={4}
            botDifficulty={botDiff}
            onDifficultyChange={setBotDiff}
            initialRoomCode={initialRoom}
            onSeatsChange={(s) => setRoomSeats(s)}
          />

          <div className="grid sm:grid-cols-2 gap-5 items-stretch">
            <button
              onClick={() => startGame("grila")}
              className="mode-card group h-[290px] w-full flex flex-col justify-end text-left cursor-pointer"
            >
              <img
                src="/art/card-crown.jpg"
                alt={t("trainGrilaTitle")}
                className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-[#09060c] via-[#120b1c]/60 to-transparent" />
              <span className="absolute top-3 right-3 bg-[#120d1c]/90 border border-[#e3b559] text-[#ffe399] font-cinzel font-bold text-xs px-3 py-1 rounded-full">
                {mcCount} Qs
              </span>
              <div className="relative z-10 p-6 flex flex-col gap-1.5">
                <span className="text-3xl">👑</span>
                <span className="font-cinzel font-extrabold text-xl tracking-wider gold-title">
                  {t("trainGrilaTitle")}
                </span>
                <span className="text-[#ead5ac] text-xs leading-relaxed">{t("trainGrilaDesc")}</span>
              </div>
            </button>

            <button
              onClick={() => startGame("rapide")}
              className="mode-card group h-[290px] w-full flex flex-col justify-end text-left cursor-pointer"
            >
              <img
                src="/art/card-banners.jpg"
                alt={t("trainRapideTitle")}
                className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-[#09060c] via-[#120b1c]/60 to-transparent" />
              <span className="absolute top-3 right-3 bg-[#120d1c]/90 border border-[#e3b559] text-[#ffe399] font-cinzel font-bold text-xs px-3 py-1 rounded-full">
                {numCount} Qs
              </span>
              <div className="relative z-10 p-6 flex flex-col gap-1.5">
                <span className="text-3xl">⚡</span>
                <span className="font-cinzel font-extrabold text-xl tracking-wider gold-title">
                  {t("trainRapideTitle")}
                </span>
                <span className="text-[#ead5ac] text-xs leading-relaxed">{t("trainRapideDesc")}</span>
              </div>
            </button>
          </div>
        </div>
      )}

      {mode !== null && phase === "loading" && (
        <div className="royal-panel rounded-2xl px-10 py-14 text-center font-cinzel text-[#f7d279] text-lg tracking-wider my-auto">
          ⏳ {t("trainLoading")}
        </div>
      )}

      {mode !== null &&
        phase === "finished" &&
        (() => {
          const total = correct + wrong + timeouts;
          const accuracy = total ? Math.round((correct / total) * 100) : 0;
          return (
            <div className="royal-panel rounded-2xl w-full max-w-[540px] p-8 flex flex-col gap-5 text-center my-auto">
              <div className="text-5xl">🏆</div>
              <h2 className="font-cinzel font-extrabold text-2xl sm:text-3xl gold-title">
                {t("trainFinished")}
              </h2>
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-[#120e1a]/80 border border-emerald-500/40 rounded-xl p-3">
                  <div className="text-2xl font-cinzel font-extrabold text-emerald-400">{correct}</div>
                  <div className="text-[0.7rem] text-[#cbb894] uppercase">{t("trainCorrect")}</div>
                </div>
                <div className="bg-[#120e1a]/80 border border-rose-500/40 rounded-xl p-3">
                  <div className="text-2xl font-cinzel font-extrabold text-rose-400">{wrong}</div>
                  <div className="text-[0.7rem] text-[#cbb894] uppercase">{t("trainWrong")}</div>
                </div>
                <div className="bg-[#120e1a]/80 border border-amber-500/40 rounded-xl p-3">
                  <div className="text-2xl font-cinzel font-extrabold text-amber-300">{accuracy}%</div>
                  <div className="text-[0.7rem] text-[#cbb894] uppercase">
                    {t("trainTimeouts")}: {timeouts}
                  </div>
                </div>
              </div>

              {roomSeats.length > 1 && (
                <div className="bg-[#120e1a]/80 border border-[#b68635]/60 rounded-xl p-3 flex flex-col gap-1.5 text-left">
                  <div className="text-[0.7rem] font-cinzel font-bold uppercase tracking-wider text-[#ffd977]">
                    👑 {t("trainRivalsTitle")}
                  </div>
                  {roomSeats
                    .map((s, sIdx) => ({
                      name: s.name,
                      score: sIdx === 0 ? correct : rivalScores[s.userId] ?? 0,
                      isMe: sIdx === 0,
                    }))
                    .sort((a, b) => b.score - a.score)
                    .map((row, rIdx) => (
                      <div
                        key={row.name + rIdx}
                        className={`flex items-center justify-between text-xs px-2.5 py-1 rounded-lg ${
                          row.isMe ? "bg-[#2c1f10] text-[#ffe28a] font-bold" : "text-[#e0cba0]"
                        }`}
                      >
                        <span>
                          #{rIdx + 1} {row.name}
                        </span>
                        <span className="font-cinzel font-bold">
                          {row.score} / {total}
                        </span>
                      </div>
                    ))}
                </div>
              )}

              <div className="flex gap-3 mt-1">
                <button
                  onClick={() => startGame(mode)}
                  className="btn-crimson flex-1 rounded-xl font-cinzel font-bold text-xs tracking-wider uppercase py-3.5 cursor-pointer"
                >
                  ⚔ {t("trainPlayAgain")}
                </button>
                <button
                  onClick={() => setMode(null)}
                  className="btn-sapphire flex-1 rounded-xl font-cinzel font-bold text-xs tracking-wider uppercase py-3.5 cursor-pointer"
                >
                  {t("trainChangeMode")}
                </button>
              </div>
            </div>
          );
        })()}

      {mode !== null &&
        phase === "playing" &&
        (() => {
          const q = questions[idx];
          const isGrila = mode === "grila";
          const pct = (timeLeft / TIMER_SECONDS) * 100;
          return (
            <div className="w-full max-w-[680px] flex flex-col gap-4 my-auto">
              <div className="royal-panel rounded-xl px-4 py-2.5 flex items-center gap-3 text-xs text-[#dfc79a]">
                <span className="font-cinzel font-bold shrink-0">
                  {t("trainQuestionOf")} {idx + 1} / {questions.length}
                </span>
                <div className="flex-1 h-2 bg-[#0d0a12] rounded-full overflow-hidden border border-[#8e672b]/60">
                  <div
                    className="h-full bg-gradient-to-r from-[#c87030] via-[#f0bc58] to-[#ffe69c] transition-all duration-150"
                    style={{ width: `${((idx + (feedback ? 1 : 0)) / questions.length) * 100}%` }}
                  />
                </div>
                <span className="font-cinzel font-bold text-[#ffd977] shrink-0">
                  {correct}✓ {wrong + timeouts}✗
                </span>
              </div>

              <div className="royal-panel rounded-2xl p-6 sm:p-8 flex flex-col gap-5">
                <div className="flex items-center gap-3.5">
                  <div
                    className={`w-14 h-14 rounded-full border-2 flex items-center justify-center font-cinzel font-extrabold text-xl shrink-0 shadow-inner ${
                      timeLeft <= 3 && !feedback
                        ? "border-red-500 text-red-400 bg-red-950/50 animate-pulse"
                        : "border-[#f3ca6b] text-[#ffe49e] bg-[#161020]"
                    }`}
                  >
                    {Math.ceil(timeLeft)}
                  </div>
                  <div className="flex-1 flex flex-col gap-1.5">
                    {q?.category && (
                      <span className="text-[0.7rem] font-cinzel tracking-widest uppercase text-[#f0c05a]">
                        ⚜ {q.category}
                      </span>
                    )}
                    <div className="h-2.5 bg-[#0c0912] rounded-full overflow-hidden border border-[#8e672b]/60">
                      <div
                        className={`h-full transition-all duration-100 ${
                          timeLeft <= 3
                            ? "bg-gradient-to-r from-red-600 to-rose-400"
                            : "bg-gradient-to-r from-[#c97e2a] via-[#f2c45e] to-[#fff0b3]"
                        }`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                </div>

                <div className="parchment-panel rounded-xl p-5 min-h-[88px] flex items-center">
                  <p className="font-cinzel font-bold text-base sm:text-lg leading-relaxed text-[#251407]">
                    {q?.prompt}
                  </p>
                </div>

                {isGrila ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {(q as GrilaQuestion).options.map((opt, i) => {
                      let cls =
                        "bg-[#130f1c]/90 border-2 border-[#8c6429] hover:border-[#f5cd71] hover:bg-[#231932] text-[#f6ead0]";
                      if (feedback) {
                        const isCorrectOpt = i === (q as GrilaQuestion).correctIndex;
                        const isSelected = i === selectedOption;
                        if (isCorrectOpt) {
                          cls =
                            "bg-emerald-900/55 border-2 border-emerald-400 text-white shadow-[0_0_16px_rgba(52,211,153,0.4)]";
                        } else if (isSelected) {
                          cls = "bg-rose-900/55 border-2 border-rose-400 text-white";
                        } else {
                          cls = "bg-[#0e0b14]/60 border-2 border-[#4d3c23] opacity-45";
                        }
                      }
                      return (
                        <button
                          key={i}
                          disabled={!!feedback}
                          onClick={() => {
                            setSelectedOption(i);
                            handleAnswer(i === (q as GrilaQuestion).correctIndex);
                          }}
                          className={`${cls} rounded-xl text-left px-4 py-3.5 text-sm font-medium cursor-pointer disabled:cursor-default transition-all flex items-start gap-2.5`}
                        >
                          <span className="font-cinzel font-extrabold text-[#f3c35c] shrink-0">
                            {String.fromCharCode(65 + i)}.
                          </span>
                          <span className="leading-snug">{opt}</span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="flex gap-2.5">
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
                          handleAnswer(parseInt(inputValue, 10) === (q as RapideQuestion).answer);
                        }
                      }}
                      disabled={!!feedback}
                      placeholder={t("trainNumericPlaceholder")}
                      className="flex-1 bg-[#0b0910] border-2 border-[#b68635] rounded-xl text-[#ffe59e] text-2xl font-cinzel font-bold text-center py-3 outline-none focus:border-[#ffe082] disabled:opacity-50"
                    />
                    <button
                      onClick={() => handleAnswer(parseInt(inputValue, 10) === (q as RapideQuestion).answer)}
                      disabled={!!feedback || inputValue === ""}
                      className="btn-crimson rounded-xl font-cinzel font-bold px-6 cursor-pointer disabled:opacity-40"
                    >
                      OK
                    </button>
                  </div>
                )}

                {feedback && (
                  <div
                    className={`rounded-xl p-4 text-center border-2 ${
                      feedback.state === "correct"
                        ? "bg-emerald-950/60 border-emerald-400/70"
                        : feedback.state === "wrong"
                        ? "bg-rose-950/60 border-rose-400/70"
                        : "bg-amber-950/60 border-amber-400/70"
                    }`}
                  >
                    <div className="text-2xl">
                      {feedback.state === "correct" ? "✔" : feedback.state === "wrong" ? "✖" : "⏱"}
                    </div>
                    <div className="font-cinzel font-bold text-base tracking-wider">
                      {feedback.state === "correct"
                        ? t("trainCorrectMsg")
                        : feedback.state === "wrong"
                        ? t("trainWrongMsg")
                        : t("trainTimeoutMsg")}
                    </div>
                    <div className="text-xs text-[#e5cfa3] mt-1">
                      {t("trainCorrectAnswer")}{" "}
                      <strong className="text-[#ffe28a]">{feedback.reveal}</strong>
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })()}
    </div>
  );
}

export default function TrainPage() {
  return (
    <Suspense
      fallback={
        <div className="arena-backdrop min-h-screen w-full flex items-center justify-center font-cinzel text-[#f7d279]">
          Loading…
        </div>
      }
    >
      <TrainContent />
    </Suspense>
  );
}
