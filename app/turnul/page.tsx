"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { LanguageSwitcher, useI18n } from "@/lib/i18n";
import { InviteToast, LobbyRoom, LobbySeat, MatchLobby } from "@/components/MatchLobby";
import { stoneSound } from "@/lib/sound";

interface Climber {
  id: string;
  name: string;
  isBot: boolean;
  botDifficulty: "easy" | "medium" | "hard";
  portrait: string;
  color: string;
  floor: number; // 0..10
  shields: number; // 2..0
  eliminated: boolean;
  lastOutcome: null | "climb" | "hit" | "ko";
  streak: number;
}

interface GrilaQ {
  id: string;
  category?: string;
  prompt: string;
  options: string[];
  correctIndex: number;
}

interface RapideQ {
  id: string;
  category?: string;
  prompt: string;
  answer: number;
}

const MAX_FLOOR = 10;
const PORTRAITS = [
  "/art/avatar-knight.jpg",
  "/art/fighter-valkyrie.jpg",
  "/art/fighter-paladin.jpg",
  "/art/fighter-rogue.jpg",
  "/art/card-duel.jpg",
  "/art/card-crown.jpg",
];
const COLORS = ["#facc15", "#38bdf8", "#fb7185", "#a78bfa", "#34d399", "#fb923c"];

function TurnulContent() {
  const { lang, t } = useI18n();
  const searchParams = useSearchParams();
  const initialRoom = searchParams.get("room");

  const [screen, setScreen] = useState<"lobby" | "playing">("lobby");
  const [seats, setSeats] = useState<LobbySeat[]>([]);
  const [room, setRoom] = useState<LobbyRoom | null>(null);
  const [botDiff, setBotDiff] = useState<"easy" | "medium" | "hard">("medium");
  const [soundOn, setSoundOn] = useState(true);

  const [climbers, setClimbers] = useState<Climber[]>([]);
  const [roundNum, setRoundNum] = useState(1);
  const [roundKind, setRoundKind] = useState<"grila" | "rapide">("grila");
  const [phase, setPhase] = useState<"loading" | "question" | "reveal" | "finished">("loading");
  const [grilaQ, setGrilaQ] = useState<GrilaQ | null>(null);
  const [rapideQ, setRapideQ] = useState<RapideQ | null>(null);
  const [timeLeft, setTimeLeft] = useState(12);
  const [roundMaxTime, setRoundMaxTime] = useState(12);
  const [selectedOpt, setSelectedOpt] = useState<number | null>(null);
  const [numInput, setNumInput] = useState("");
  const [revealInfo, setRevealInfo] = useState<{
    correctText: string;
    playerOk: boolean;
  } | null>(null);
  const [winner, setWinner] = useState<Climber | null>(null);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startRef = useRef<number>(0);
  const answeredRef = useRef<boolean>(false);
  const lastTickSecRef = useRef<number>(99);
  const climbersRef = useRef<Climber[]>([]);
  climbersRef.current = climbers;
  const numInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    stoneSound.enabled = soundOn;
  }, [soundOn]);

  const clearTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  };
  useEffect(() => () => clearTimer(), []);

  const loadFloorRound = useCallback(
    async (nextRound: number) => {
      clearTimer();
      answeredRef.current = false;
      setSelectedOpt(null);
      setNumInput("");
      setRevealInfo(null);
      setRoundNum(nextRound);
      setPhase("loading");

      // Every 3rd floor is a Rapid Numeric trial, others are Multiple Choice (Grilă)
      const kind: "grila" | "rapide" = nextRound % 3 === 0 ? "rapide" : "grila";
      setRoundKind(kind);

      // Escalating timer speed like Royale Turnul
      const limitSec = nextRound >= 7 ? 8 : nextRound >= 4 ? 10 : 12;
      setRoundMaxTime(limitSec);
      setTimeLeft(limitSec);
      lastTickSecRef.current = limitSec;

      try {
        const res = await fetch(`/api/questions?mode=${kind}&count=1&lang=${lang}`);
        const data = await res.json();
        const q = data?.questions?.[0];
        if (!q) return;
        if (kind === "grila") {
          setGrilaQ(q);
          setRapideQ(null);
        } else {
          setRapideQ(q);
          setGrilaQ(null);
          setTimeout(() => numInputRef.current?.focus(), 40);
        }
        startRef.current = Date.now();
        setPhase("question");

        timerRef.current = setInterval(() => {
          const left = Math.max(0, limitSec - (Date.now() - startRef.current) / 1000);
          setTimeLeft(left);
          const ceilSec = Math.ceil(left);
          if (ceilSec <= 3 && ceilSec > 0 && ceilSec < lastTickSecRef.current) {
            lastTickSecRef.current = ceilSec;
            stoneSound.tick();
          }
          if (left <= 0) {
            clearTimer();
            if (!answeredRef.current) {
              resolveRoundRef.current(false, kind === "grila" ? q.options[q.correctIndex] : String(q.answer));
            }
          }
        }, 80);
      } catch {
        /* ignore */
      }
    },
    [lang]
  );

  const resolveRound = useCallback(
    (playerCorrect: boolean, correctText: string) => {
      if (answeredRef.current) return;
      answeredRef.current = true;
      clearTimer();

      const updated: Climber[] = climbersRef.current.map((c, idx) => {
        if (c.eliminated) return { ...c, lastOutcome: null };
        let ok = false;
        if (idx === 0) {
          ok = playerCorrect;
        } else {
          const acc = c.botDifficulty === "easy" ? 0.52 : c.botDifficulty === "medium" ? 0.7 : 0.84;
          ok = Math.random() < acc;
        }

        if (ok) {
          return {
            ...c,
            floor: Math.min(MAX_FLOOR, c.floor + 1),
            streak: c.streak + 1,
            lastOutcome: "climb",
          };
        }
        const nextShields = Math.max(0, c.shields - 1);
        return {
          ...c,
          shields: nextShields,
          eliminated: nextShields === 0,
          streak: 0,
          lastOutcome: nextShields === 0 ? "ko" : "hit",
        };
      });

      setClimbers(updated);
      setRevealInfo({ correctText, playerOk: playerCorrect });
      setPhase("reveal");

      if (playerCorrect) stoneSound.climbStep(updated[0]?.floor ?? 1);
      else stoneSound.shieldCrack();

      // Check win conditions: reached Floor 10 OR only 1 climber alive OR player eliminated -> crown highest survivor
      const alive = updated.filter((c) => !c.eliminated);
      const summit = alive.find((c) => c.floor >= MAX_FLOOR);
      const finished = Boolean(summit) || alive.length <= 1 || updated[0]?.eliminated;

      setTimeout(() => {
        if (finished) {
          const sorted = [...updated].sort(
            (a, b) => Number(a.eliminated) - Number(b.eliminated) || b.floor - a.floor || b.shields - a.shields
          );
          setWinner(sorted[0] ?? null);
          setPhase("finished");
          stoneSound.victoryFanfare();
        } else {
          loadFloorRound(roundNum + 1);
        }
      }, 2100);
    },
    [loadFloorRound, roundNum]
  );

  const resolveRoundRef = useRef(resolveRound);
  resolveRoundRef.current = resolveRound;

  const startTurnul = async () => {
    // Ensure at least 4 climbers (fill with bots if seats are still open)
    let activeSeats = seats;
    if (activeSeats.length < 4 && room) {
      const res = await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "fillBots", code: room.code, difficulty: botDiff }),
      });
      if (res.ok) {
        const d = await res.json();
        activeSeats = d.room?.seats ?? activeSeats;
        setSeats(activeSeats);
      }
    }

    const roster: Climber[] = activeSeats.map((s, idx) => ({
      id: s.userId,
      name: s.name,
      isBot: s.isBot,
      botDifficulty: s.botDifficulty || botDiff,
      portrait: PORTRAITS[idx % PORTRAITS.length],
      color: COLORS[idx % COLORS.length],
      floor: 0,
      shields: 2,
      eliminated: false,
      lastOutcome: null,
      streak: 0,
    }));

    setClimbers(roster);
    climbersRef.current = roster;
    setWinner(null);
    setScreen("playing");
    stoneSound.warHorn();
    loadFloorRound(1);
  };

  // Keyboard shortcuts 1-4 / A-D in Grilă floors
  useEffect(() => {
    if (screen !== "playing" || phase !== "question" || roundKind !== "grila" || !grilaQ) return;
    const onKey = (e: KeyboardEvent) => {
      const map: Record<string, number> = { "1": 0, "2": 1, "3": 2, "4": 3, a: 0, b: 1, c: 2, d: 3 };
      const idx = map[e.key.toLowerCase()];
      if (idx !== undefined && idx < grilaQ.options.length) {
        setSelectedOpt(idx);
        resolveRound(idx === grilaQ.correctIndex, grilaQ.options[grilaQ.correctIndex]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [screen, phase, roundKind, grilaQ, resolveRound]);

  const submitRapide = () => {
    if (!rapideQ || numInput === "" || answeredRef.current) return;
    const guess = parseInt(numInput, 10);
    const denom = Math.max(Math.abs(rapideQ.answer), 1);
    const ok = Math.abs(guess - rapideQ.answer) / denom <= 0.1; // within 10% counts as climb!
    resolveRound(ok, String(rapideQ.answer));
  };

  return (
    <div className="arena-backdrop min-h-screen w-full px-3 sm:px-6 py-4 flex flex-col items-center">
      <InviteToast />

      {/* Header */}
      <header className="w-full max-w-[1140px] flex flex-wrap items-center justify-between gap-3 mb-4">
        <Link
          href="/"
          className="royal-panel hover:border-[#f5cd71] rounded-xl px-4 py-2 text-xs font-cinzel font-bold tracking-wider text-[#f7e1b0] hover:text-white transition-all"
        >
          ← {t("fightBackLobby")}
        </Link>

        <div className="text-center royal-panel rounded-2xl px-6 py-2">
          <h1 className="font-cinzel font-extrabold text-xl sm:text-2xl tracking-[0.14em] gold-title leading-none">
            🗼 {t("turnulTitle")}
          </h1>
          <p className="text-[0.7rem] text-[#e8d3aa] hidden sm:block mt-0.5">{t("turnulSubtitle")}</p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setSoundOn((v) => !v)}
            className="royal-panel rounded-xl px-3 py-1.5 text-xs font-cinzel text-[#f7e1b0] hover:border-[#f5cd71] cursor-pointer"
          >
            {soundOn ? `🔊 ${t("fightSoundOn")}` : `🔇 ${t("fightSoundOff")}`}
          </button>
          <LanguageSwitcher compact />
        </div>
      </header>

      {/* ==================== MULTIPLAYER TURNUL LOBBY ==================== */}
      {screen === "lobby" && (
        <div className="w-full max-w-[1000px] flex flex-col gap-5">
          <div className="royal-panel rounded-2xl overflow-hidden grid sm:grid-cols-[220px_1fr]">
            <img
              src="/art/card-crown.jpg"
              alt={t("turnulTitle")}
              className="w-full h-56 sm:h-full object-cover"
            />
            <div className="p-5 sm:p-6 flex flex-col justify-center gap-3">
              <h2 className="font-cinzel font-extrabold text-2xl gold-title">{t("turnulTitle")}</h2>
              <p className="text-xs sm:text-sm text-[#e8d5b0] leading-relaxed">{t("turnulHowItWorks")}</p>
              <div className="flex flex-wrap gap-2 text-[0.7rem] font-cinzel text-[#ffe28a]">
                <span className="bg-[#181224] border border-[#b68635]/60 rounded-full px-3 py-1">
                  👥 2–6 Players
                </span>
                <span className="bg-[#181224] border border-[#b68635]/60 rounded-full px-3 py-1">
                  🗼 10 {t("turnulFloor")}
                </span>
                <span className="bg-[#181224] border border-[#b68635]/60 rounded-full px-3 py-1">
                  🛡 2 {t("turnulShields")}
                </span>
              </div>
            </div>
          </div>

          <MatchLobby
            gameType="turnul"
            maxSeats={6}
            botDifficulty={botDiff}
            onDifficultyChange={setBotDiff}
            initialRoomCode={initialRoom}
            onSeatsChange={(s, r) => {
              setSeats(s);
              setRoom(r);
            }}
          />

          <div className="flex justify-center">
            <button
              type="button"
              onClick={startTurnul}
              className="btn-crimson rounded-2xl px-14 py-4 font-cinzel font-extrabold text-lg sm:text-xl tracking-[0.2em] uppercase cursor-pointer animate-gold-glow"
            >
              🗼 {t("turnulStart")} 🗼
            </button>
          </div>
        </div>
      )}

      {/* ==================== LIVE MULTIPLAYER TOWER CLIMB ==================== */}
      {screen === "playing" && (
        <div className="w-full max-w-[1140px] grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-5 items-start">
          {/* LEFT: Photorealistic Stone-Textured 10-Floor Citadel Tower */}
          <div
            className="royal-panel rounded-2xl p-4 flex flex-col gap-2 relative overflow-hidden"
            style={{
              backgroundImage:
                "linear-gradient(180deg, rgba(16,12,24,0.86) 0%, rgba(20,16,24,0.82) 55%, rgba(12,9,15,0.92) 100%), url('/art/textures/stone.jpg')",
              backgroundSize: "cover",
            }}
          >
            <div className="flex items-center justify-between border-b border-[#b68635]/40 pb-2">
              <span className="font-cinzel font-extrabold text-xs tracking-[0.16em] uppercase text-[#ffd977]">
                👑 {t("turnulTitle")} • 1–{MAX_FLOOR}
              </span>
              <span className="text-xs font-cinzel text-[#cbb384]">
                {t("fightRound")} {roundNum}
              </span>
            </div>

            {/* 10 Stone Floors stacked vertically (Floor 10 Crown Summit -> Floor 0 Base) */}
            <div className="flex flex-col gap-1.5">
              {Array.from({ length: MAX_FLOOR + 1 }, (_, i) => MAX_FLOOR - i).map((fl) => {
                const here = climbers.filter((c) => c.floor === fl);
                const isSummit = fl === MAX_FLOOR;
                return (
                  <div
                    key={fl}
                    className={`rounded-xl px-3 py-1.5 border flex items-center justify-between gap-2 min-h-[40px] transition-all ${
                      isSummit
                        ? "bg-gradient-to-r from-[#4b2d0c] via-[#754814] to-[#4b2d0c] border-[#ffe28a] shadow-[0_0_16px_rgba(255,215,96,0.35)]"
                        : fl % 2 === 0
                        ? "bg-[#1a1524]/90 border-[#7a5828]/45"
                        : "bg-[#14101c]/90 border-[#634720]/35"
                    }`}
                  >
                    <span
                      className={`font-cinzel font-extrabold text-[0.7rem] shrink-0 w-16 ${
                        isSummit ? "text-[#fff0a8]" : "text-[#cbb384]"
                      }`}
                    >
                      {isSummit ? "👑 TOP 10" : fl === 0 ? "⚔ START" : `${t("turnulFloor")} ${fl}`}
                    </span>

                    <div className="flex-1 flex flex-wrap items-center justify-end gap-1.5">
                      {here.map((c) => (
                        <div
                          key={c.id}
                          className={`flex items-center gap-1.5 rounded-full pr-2 pl-0.5 py-0.5 border text-[0.65rem] font-cinzel font-bold transition-all duration-500 ${
                            c.eliminated
                              ? "opacity-40 grayscale border-rose-500/60 bg-rose-950/60 line-through"
                              : c.lastOutcome === "climb"
                              ? "border-emerald-400 bg-emerald-950/80 scale-105 shadow-[0_0_12px_rgba(52,211,153,0.5)]"
                              : c.lastOutcome === "hit"
                              ? "border-amber-400 bg-rose-950/80"
                              : "border-[#d4a147] bg-[#0e0a15]/90"
                          }`}
                        >
                          <img
                            src={c.portrait}
                            alt={c.name}
                            className="w-5 h-5 rounded-full object-cover border"
                            style={{ borderColor: c.color }}
                          />
                          <span className="max-w-[78px] truncate text-[#ffefc8]">{c.name}</span>
                          <span>{c.eliminated ? "💀" : "🛡".repeat(c.shields)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* RIGHT: Active Climber Roster + Live Trivia Challenge Console */}
          <div className="flex flex-col gap-4">
            {/* Climbers Scoreboard Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              {climbers.map((c, idx) => (
                <div
                  key={c.id}
                  className={`royal-panel rounded-xl p-2.5 flex items-center gap-2.5 transition-all ${
                    idx === 0 ? "ring-2 ring-[#ffe28a]" : ""
                  } ${c.eliminated ? "opacity-45 grayscale" : ""}`}
                >
                  <img
                    src={c.portrait}
                    alt={c.name}
                    className="w-10 h-10 rounded-full object-cover border-2 shrink-0"
                    style={{ borderColor: c.color }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="font-cinzel font-bold text-xs text-[#ffefc8] truncate">
                      {c.name}
                    </div>
                    <div className="text-[0.68rem] text-[#ffd977] flex items-center justify-between">
                      <span>
                        {t("turnulFloor")} {c.floor}
                      </span>
                      <span>{c.eliminated ? t("turnulEliminated") : "🛡".repeat(c.shields)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Active Question / Reveal / Victory Card */}
            <div className="royal-panel rounded-2xl p-5 sm:p-7 flex flex-col gap-4">
              {phase === "loading" && (
                <div className="py-12 text-center font-cinzel text-[#f7d279]">⏳ {t("trainLoading")}</div>
              )}

              {phase === "finished" && (
                <div className="py-8 flex flex-col items-center text-center gap-4">
                  <div className="text-6xl">👑</div>
                  <div className="font-cinzel font-extrabold text-3xl gold-title">
                    {t("turnulCrownWinner")}
                  </div>
                  {winner && (
                    <div className="flex items-center gap-3 bg-[#140e1d] border-2 border-[#ffe28a] rounded-2xl px-6 py-3">
                      <img
                        src={winner.portrait}
                        alt={winner.name}
                        className="w-14 h-14 rounded-full object-cover border-2 border-[#ffe28a]"
                      />
                      <div className="text-left">
                        <div className="font-cinzel font-extrabold text-xl text-[#fff0b3]">
                          {winner.name}
                        </div>
                        <div className="text-xs text-[#d6be92]">
                          {t("turnulFloor")} {winner.floor}/{MAX_FLOOR} • {"🛡".repeat(winner.shields)}
                        </div>
                      </div>
                    </div>
                  )}
                  <div className="flex gap-3 mt-2">
                    <button
                      type="button"
                      onClick={startTurnul}
                      className="btn-crimson rounded-xl px-6 py-3 font-cinzel font-bold text-xs sm:text-sm uppercase cursor-pointer"
                    >
                      🗼 {t("fightRematch")}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        clearTimer();
                        setScreen("lobby");
                      }}
                      className="btn-sapphire rounded-xl px-6 py-3 font-cinzel font-bold text-xs sm:text-sm uppercase cursor-pointer"
                    >
                      {t("lobbyTitle").split("—")[0]}
                    </button>
                  </div>
                </div>
              )}

              {(phase === "question" || phase === "reveal") && (
                <>
                  {/* Timer + Round Kind */}
                  <div className="flex items-center gap-3.5">
                    <div
                      className={`w-14 h-14 rounded-full border-2 flex items-center justify-center font-cinzel font-extrabold text-xl shrink-0 ${
                        phase === "question" && timeLeft <= 3
                          ? "border-red-500 text-red-400 bg-red-950/50 animate-pulse"
                          : "border-[#f3ca6b] text-[#ffe49e] bg-[#161020]"
                      }`}
                    >
                      {Math.ceil(timeLeft)}
                    </div>
                    <div className="flex-1 flex flex-col gap-1.5">
                      <span className="text-xs font-cinzel font-bold tracking-widest uppercase text-[#f0c05a]">
                        🗼 {roundKind === "grila" ? t("turnulGrilaRound") : t("turnulRapideRound")}
                        {(grilaQ?.category || rapideQ?.category)
                          ? ` • ${grilaQ?.category || rapideQ?.category}`
                          : ""}
                      </span>
                      <div className="h-2.5 bg-[#0c0912] rounded-full overflow-hidden border border-[#8e672b]/60">
                        <div
                          className={`h-full transition-all duration-100 ${
                            timeLeft <= 3
                              ? "bg-gradient-to-r from-red-600 to-rose-400"
                              : "bg-gradient-to-r from-[#c97e2a] via-[#f2c45e] to-[#fff0b3]"
                          }`}
                          style={{ width: `${(timeLeft / roundMaxTime) * 100}%` }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Parchment Question Scroll */}
                  <div className="parchment-panel rounded-xl p-5 min-h-[82px] flex items-center">
                    <p className="font-cinzel font-bold text-base sm:text-lg text-[#241306] leading-relaxed">
                      {roundKind === "grila" ? grilaQ?.prompt : rapideQ?.prompt}
                    </p>
                  </div>

                  {roundKind === "grila" && grilaQ ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {grilaQ.options.map((opt, i) => {
                        let cls =
                          "bg-[#130f1c]/90 border-2 border-[#8c6429] hover:border-[#f5cd71] hover:bg-[#231932] text-[#f6ead0]";
                        if (phase === "reveal") {
                          if (i === grilaQ.correctIndex) {
                            cls = "bg-emerald-900/60 border-2 border-emerald-400 text-white";
                          } else if (i === selectedOpt) {
                            cls = "bg-rose-900/60 border-2 border-rose-400 text-white";
                          } else {
                            cls = "bg-[#0e0b14]/60 border-2 border-[#4d3c23] opacity-45";
                          }
                        }
                        return (
                          <button
                            key={i}
                            type="button"
                            disabled={phase !== "question"}
                            onClick={() => {
                              setSelectedOpt(i);
                              resolveRound(i === grilaQ.correctIndex, grilaQ.options[grilaQ.correctIndex]);
                            }}
                            className={`${cls} rounded-xl text-left px-4 py-3.5 text-sm font-medium cursor-pointer disabled:cursor-default transition-all flex items-start gap-2.5`}
                          >
                            <span className="font-cinzel font-extrabold text-[#f3c35c] shrink-0">
                              {String.fromCharCode(65 + i)}.
                            </span>
                            <span>{opt}</span>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="flex gap-2.5">
                      <input
                        ref={numInputRef}
                        type="text"
                        inputMode="numeric"
                        value={numInput}
                        disabled={phase !== "question"}
                        onChange={(e) => {
                          const v = e.target.value.replace(/[^0-9-]/g, "");
                          if (/^-?\d*$/.test(v)) setNumInput(v);
                        }}
                        onKeyDown={(e) => e.key === "Enter" && submitRapide()}
                        placeholder={t("trainNumericPlaceholder")}
                        className="flex-1 bg-[#0b0910] border-2 border-[#b68635] rounded-xl text-[#ffe59e] text-2xl font-cinzel font-bold text-center py-3 outline-none focus:border-[#ffe082]"
                      />
                      <button
                        type="button"
                        disabled={phase !== "question" || numInput === ""}
                        onClick={submitRapide}
                        className="btn-crimson rounded-xl font-cinzel font-bold px-7 cursor-pointer disabled:opacity-40"
                      >
                        OK
                      </button>
                    </div>
                  )}

                  {phase === "reveal" && revealInfo && (
                    <div
                      className={`rounded-xl p-4 text-center border-2 ${
                        revealInfo.playerOk
                          ? "bg-emerald-950/65 border-emerald-400"
                          : "bg-rose-950/65 border-rose-400"
                      }`}
                    >
                      <div className="font-cinzel font-extrabold text-base">
                        {revealInfo.playerOk ? `⬆ ${t("turnulYouClimbed")}` : `🛡💥 ${t("turnulShieldBroken")}`}
                      </div>
                      <div className="text-xs text-[#e8d5b0] mt-1">
                        {t("fightAnswerWas")}{" "}
                        <strong className="text-[#ffe28a]">{revealInfo.correctText}</strong>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function TurnulPage() {
  return (
    <Suspense
      fallback={
        <div className="arena-backdrop min-h-screen w-full flex items-center justify-center font-cinzel text-[#f7d279]">
          Loading…
        </div>
      }
    >
      <TurnulContent />
    </Suspense>
  );
}
