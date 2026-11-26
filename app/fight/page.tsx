"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { LanguageSwitcher, useI18n } from "@/lib/i18n";
import { ThemeSwitcher, useArtTheme } from "@/lib/theme";
import { FIGHTERS, FighterDef, arcadeAudio } from "@/lib/fighters";
import { InviteToast, LobbyRoom, LobbySeat, MatchLobby } from "@/components/MatchLobby";

type GameMode = "1p" | "2p";
type AiDifficulty = "easy" | "medium" | "hard";
type FighterState = "idle" | "dash" | "retreat" | "block" | "light" | "heavy" | "special" | "hitstun" | "ko" | "victory";
type AttackSeqType = "normal" | "critCombo" | "superWave" | "clash" | "miss";

interface FighterEntity {
  slot: 1 | 2;
  def: FighterDef;
  x: number;
  homeX: number;
  y: number;
  vx: number;
  vy: number;
  facing: 1 | -1;
  hp: number;
  maxHp: number;
  displayHp: number;
  superMeter: number; // 0..100
  state: FighterState;
  stateTimer: number;
  hitFlash: number;
  comboCount: number;
  animTime: number;
}

interface AttackSequence {
  type: AttackSeqType;
  attacker: 1 | 2;
  defender: 1 | 2;
  damage: number;
  frame: number;
  duration: number;
  hitsLanded: number;
  projectileFired: boolean;
}

interface Projectile {
  owner: 1 | 2;
  x: number;
  y: number;
  vx: number;
  radius: number;
  damage: number;
  color: string;
  accent: string;
  life: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
}

interface FloatingText {
  x: number;
  y: number;
  vy: number;
  text: string;
  color: string;
  life: number;
  scale: number;
}

interface QuizQuestion {
  id: string;
  category?: string;
  prompt: string;
  options: string[];
  correctIndex: number;
}

const STAGE_W = 960;
const STAGE_H = 480;
const GROUND_Y = 415;
const P1_HOME = 240;
const P2_HOME = STAGE_W - 240;
const QUESTION_SECONDS = 12;

function makeFighter(slot: 1 | 2, def: FighterDef): FighterEntity {
  const homeX = slot === 1 ? P1_HOME : P2_HOME;
  return {
    slot,
    def,
    x: homeX,
    homeX,
    y: GROUND_Y,
    vx: 0,
    vy: 0,
    facing: slot === 1 ? 1 : -1,
    hp: def.stats.hp,
    maxHp: def.stats.hp,
    displayHp: def.stats.hp,
    superMeter: 20,
    state: "idle",
    stateTimer: 0,
    hitFlash: 0,
    comboCount: 0,
    animTime: 0,
  };
}

function QuizFighterContent() {
  const { lang, t } = useI18n();
  const { art } = useArtTheme();
  const searchParams = useSearchParams();
  const initialRoom = searchParams.get("room");
  const [screen, setScreen] = useState<"select" | "battle">("select");
  const [gameMode, setGameMode] = useState<GameMode>("1p");
  const [aiDiff, setAiDiff] = useState<AiDifficulty>("medium");
  const [soundOn, setSoundOn] = useState<boolean>(true);
  const [p1Idx, setP1Idx] = useState<number>(0);
  const [p2Idx, setP2Idx] = useState<number>(1);
  const [lobbySeats, setLobbySeats] = useState<LobbySeat[]>([]);
  const [lobbyRoom, setLobbyRoom] = useState<LobbyRoom | null>(null);

  // Question-driven combat phase:
  // "loading" -> fetching question
  // "question" -> fighters hold idle stance while question is active (NO attacks!)
  // "attacking" -> animated Street Fighter attack sequence plays after question is answered!
  // "matchOver" -> KO & Victory screen
  const [battlePhase, setBattlePhase] = useState<"loading" | "question" | "attacking" | "matchOver">("loading");
  const [activeTurn, setActiveTurn] = useState<1 | 2>(1);
  const [turnNum, setTurnNum] = useState<number>(1);
  const [question, setQuestion] = useState<QuizQuestion | null>(null);
  const [timeLeft, setTimeLeft] = useState<number>(QUESTION_SECONDS);
  const [selectedOpt, setSelectedOpt] = useState<number | null>(null);
  const [outcomeBanner, setOutcomeBanner] = useState<{
    headline: string;
    correctAnswer: string;
    timeSummary: string;
    tone: "good" | "bad" | "neutral" | "super";
  } | null>(null);

  const [hud, setHud] = useState({
    p1Hp: 100,
    p1DisplayHp: 100,
    p1MaxHp: 100,
    p1Super: 20,
    p1Combo: 0,
    p2Hp: 100,
    p2DisplayHp: 100,
    p2MaxHp: 100,
    p2Super: 20,
    p2Combo: 0,
    matchWinner: null as null | 1 | 2,
    koText: "",
  });

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageImgRef = useRef<HTMLImageElement | null>(null);
  const questionStartRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const answeredRef = useRef<boolean>(false);
  const battlePhaseRef = useRef(battlePhase);
  battlePhaseRef.current = battlePhase;

  const simRef = useRef({
    running: false,
    hitStop: 0,
    shake: 0,
    p1: makeFighter(1, FIGHTERS[0]),
    p2: makeFighter(2, FIGHTERS[1]),
    sequence: null as AttackSequence | null,
    projectiles: [] as Projectile[],
    particles: [] as Particle[],
    texts: [] as FloatingText[],
    matchWinner: null as null | 1 | 2,
    koText: "",
  });

  useEffect(() => {
    arcadeAudio.enabled = soundOn;
  }, [soundOn]);

  useEffect(() => {
    const img = new Image();
    img.src = art.fightStage;
    img.onload = () => {
      stageImgRef.current = img;
    };
  }, [art.fightStage]);

  const clearQTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  };

  const spawnSparks = (x: number, y: number, color: string, count: number, speed = 7) => {
    const s = simRef.current;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 1.6 + Math.random() * speed;
      s.particles.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 1.8,
        life: 18 + Math.floor(Math.random() * 14),
        maxLife: 32,
        size: 2.5 + Math.random() * 4.5,
        color,
      });
    }
  };

  const spawnText = (x: number, y: number, text: string, color: string, scale = 1) => {
    simRef.current.texts.push({ x, y, vy: -1.3, text, color, life: 52, scale });
  };

  const fetchNextQuestion = useCallback(
    async (nextTurnSlot: 1 | 2, nextTurnNumber: number) => {
      clearQTimer();
      answeredRef.current = false;
      setSelectedOpt(null);
      setOutcomeBanner(null);
      setActiveTurn(nextTurnSlot);
      setTurnNum(nextTurnNumber);
      setBattlePhase("loading");

      try {
        const res = await fetch(`/api/questions?mode=grila&count=1&lang=${lang}`);
        const data = await res.json();
        const q: QuizQuestion | undefined = data?.questions?.[0];
        if (!q) {
          setBattlePhase("question");
          return;
        }
        setQuestion(q);
        setTimeLeft(QUESTION_SECONDS);
        questionStartRef.current = Date.now();
        setBattlePhase("question");

        timerRef.current = setInterval(() => {
          const elapsed = (Date.now() - questionStartRef.current) / 1000;
          const rem = Math.max(0, QUESTION_SECONDS - elapsed);
          setTimeLeft(rem);
          if (rem <= 0) {
            clearQTimer();
            if (!answeredRef.current) {
              triggerResolutionRef.current(q, -1, QUESTION_SECONDS, nextTurnSlot);
            }
          }
        }, 80);
      } catch {
        setBattlePhase("question");
      }
    },
    [lang]
  );

  // Trigger a Street Fighter cinematic attack sequence ONLY after a question is answered!
  const triggerResolution = useCallback(
    (q: QuizQuestion, chosenIdx: number, elapsedSec: number, turnSlot: 1 | 2) => {
      if (answeredRef.current) return;
      answeredRef.current = true;
      clearQTimer();
      setSelectedOpt(chosenIdx);

      const s = simRef.current;
      const isCorrect = chosenIdx === q.correctIndex;
      fetch("/api/stats/daily", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ correct: isCorrect ? 1 : 0, wrong: isCorrect ? 0 : 1 }),
      }).catch(() => {});
      const isTimeout = chosenIdx === -1;
      const isFast = isCorrect && elapsedSec <= 4.5;
      const correctText = q.options[q.correctIndex] ?? "";

      let seqType: AttackSeqType = "normal";
      let attackerSlot: 1 | 2 = turnSlot;
      let defenderSlot: 1 | 2 = turnSlot === 1 ? 2 : 1;
      let damage = 18;
      let headline = t("fightCorrectStrike");
      let tone: "good" | "bad" | "neutral" | "super" = "good";
      const myTimeStr = isTimeout ? `${QUESTION_SECONDS.toFixed(2)}s` : `${elapsedSec.toFixed(2)}s`;
      let timeSummary = `⏱ ${myTimeStr}`;

      if (gameMode === "1p") {
        // 1P vs AI: AI also answers based on difficulty
        const aiAccuracy = aiDiff === "easy" ? 0.42 : aiDiff === "medium" ? 0.65 : 0.82;
        const aiCorrect = Math.random() < aiAccuracy;
        const aiSpeed = aiDiff === "easy" ? 5 + Math.random() * 5 : aiDiff === "medium" ? 3.2 + Math.random() * 4.5 : 2.0 + Math.random() * 3.5;
        timeSummary = `⏱ ${lang === "ro" ? "Tu" : "You"}: ${myTimeStr} · AI: ${aiSpeed.toFixed(2)}s`;

        if (isCorrect && (!aiCorrect || elapsedSec <= aiSpeed)) {
          attackerSlot = 1;
          defenderSlot = 2;
          const p1 = s.p1;
          if (p1.superMeter >= 100) {
            seqType = "superWave";
            damage = Math.round(34 * p1.def.stats.power);
            p1.superMeter = 0;
            headline = `${p1.def.specialName}! ${t("fightSuperStrike")}`;
            tone = "super";
          } else if (aiCorrect) {
            seqType = "clash";
            damage = Math.round(14 * p1.def.stats.power);
            p1.superMeter = Math.min(100, p1.superMeter + 30);
            headline = t("fightBlockedClash");
            tone = "good";
          } else if (isFast) {
            seqType = "critCombo";
            damage = Math.round(25 * p1.def.stats.power);
            p1.superMeter = Math.min(100, p1.superMeter + 40);
            headline = t("fightFastCrit");
            tone = "super";
          } else {
            seqType = "normal";
            damage = Math.round(19 * p1.def.stats.power);
            p1.superMeter = Math.min(100, p1.superMeter + 32);
            headline = t("fightCorrectStrike");
            tone = "good";
          }
        } else if (isCorrect && aiCorrect && elapsedSec > aiSpeed) {
          // Both right, AI was slightly faster -> Clash glancing blow
          attackerSlot = 2;
          defenderSlot = 1;
          seqType = "clash";
          damage = Math.round(12 * s.p2.def.stats.power);
          s.p1.superMeter = Math.min(100, s.p1.superMeter + 20);
          s.p2.superMeter = Math.min(100, s.p2.superMeter + 28);
          headline = t("fightBlockedClash");
          tone = "neutral";
        } else if (!isCorrect && aiCorrect) {
          attackerSlot = 2;
          defenderSlot = 1;
          const p2 = s.p2;
          if (p2.superMeter >= 100) {
            seqType = "superWave";
            damage = Math.round(30 * p2.def.stats.power);
            p2.superMeter = 0;
            headline = `${p2.def.specialName}! ${t("fightCounterHit")}`;
          } else {
            seqType = aiDiff === "hard" ? "critCombo" : "normal";
            damage = Math.round((aiDiff === "hard" ? 23 : 18) * p2.def.stats.power);
            p2.superMeter = Math.min(100, p2.superMeter + 35);
            headline = isTimeout ? t("fightTimeoutCounter") : t("fightCounterHit");
          }
          tone = "bad";
        } else {
          // Both wrong!
          seqType = "miss";
          damage = 0;
          headline = t("fightBothMiss");
          tone = "neutral";
        }
      } else {
        // 2P Local Turn-Based: active player answers -> right = they attack, wrong = opponent counter-attacks!
        if (isCorrect) {
          attackerSlot = turnSlot;
          defenderSlot = turnSlot === 1 ? 2 : 1;
          const atk = attackerSlot === 1 ? s.p1 : s.p2;
          if (atk.superMeter >= 100) {
            seqType = "superWave";
            damage = Math.round(34 * atk.def.stats.power);
            atk.superMeter = 0;
            headline = `${atk.def.specialName}! ${t("fightSuperStrike")}`;
            tone = "super";
          } else if (isFast) {
            seqType = "critCombo";
            damage = Math.round(25 * atk.def.stats.power);
            atk.superMeter = Math.min(100, atk.superMeter + 40);
            headline = t("fightFastCrit");
            tone = "super";
          } else {
            seqType = "normal";
            damage = Math.round(19 * atk.def.stats.power);
            atk.superMeter = Math.min(100, atk.superMeter + 32);
            headline = t("fightCorrectStrike");
            tone = "good";
          }
        } else {
          attackerSlot = turnSlot === 1 ? 2 : 1;
          defenderSlot = turnSlot;
          const ctr = attackerSlot === 1 ? s.p1 : s.p2;
          seqType = "normal";
          damage = Math.round(16 * ctr.def.stats.power);
          ctr.superMeter = Math.min(100, ctr.superMeter + 25);
          headline = isTimeout ? t("fightTimeoutCounter") : t("fightCounterHit");
          tone = "bad";
        }
      }

      setOutcomeBanner({ headline, correctAnswer: correctText, timeSummary, tone });
      setBattlePhase("attacking");

      const dur = seqType === "critCombo" ? 115 : seqType === "superWave" ? 110 : seqType === "miss" ? 65 : 95;
      s.sequence = {
        type: seqType,
        attacker: attackerSlot,
        defender: defenderSlot,
        damage,
        frame: 0,
        duration: dur,
        hitsLanded: 0,
        projectileFired: false,
      };
      if (seqType === "miss") {
        arcadeAudio.block();
      } else {
        arcadeAudio.slash();
      }
    },
    [aiDiff, gameMode, t]
  );

  const triggerResolutionRef = useRef(triggerResolution);
  triggerResolutionRef.current = triggerResolution;

  const launchMatch = () => {
    clearQTimer();
    const s = simRef.current;
    s.running = true;
    s.p1 = makeFighter(1, FIGHTERS[p1Idx]);
    s.p2 = makeFighter(2, FIGHTERS[p2Idx]);
    s.sequence = null;
    s.projectiles = [];
    s.particles = [];
    s.texts = [];
    s.hitStop = 0;
    s.shake = 0;
    s.matchWinner = null;
    s.koText = "";
    setScreen("battle");
    arcadeAudio.bell();
    fetchNextQuestion(1, 1);
  };

  // Keyboard shortcuts 1-4 / Numpad1-4 / A-D while answering a question
  useEffect(() => {
    if (screen !== "battle" || battlePhase !== "question" || !question) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const codeMap: Record<string, number> = {
        Digit1: 0,
        Numpad1: 0,
        KeyA: 0,
        Digit2: 1,
        Numpad2: 1,
        KeyB: 1,
        Digit3: 2,
        Numpad3: 2,
        KeyC: 2,
        Digit4: 3,
        Numpad4: 3,
        KeyD: 3,
      };
      const keyMap: Record<string, number> = { "1": 0, "2": 1, "3": 2, "4": 3, a: 0, b: 1, c: 2, d: 3 };
      const idx = codeMap[e.code] ?? keyMap[e.key.toLowerCase()];
      if (idx !== undefined && idx < question.options.length) {
        e.preventDefault();
        const elapsed = (Date.now() - questionStartRef.current) / 1000;
        triggerResolution(question, idx, elapsed, activeTurn);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [screen, battlePhase, question, activeTurn, triggerResolution]);

  useEffect(() => () => clearQTimer(), []);

  // Main 60fps Canvas Loop (idle stances while answering; choreographed Street Fighter attack sequences after answering!)
  useEffect(() => {
    if (screen !== "battle") return;
    let rafId = 0;
    let frameTick = 0;

    const dealDamageHit = (
      attacker: FighterEntity,
      defender: FighterEntity,
      dmg: number,
      heavy: boolean,
      blocked: boolean
    ) => {
      const s = simRef.current;
      defender.hp = Math.max(0, defender.hp - dmg);
      defender.hitFlash = blocked ? 4 : 10;
      defender.state = blocked ? "block" : "hitstun";
      defender.stateTimer = heavy ? 22 : 14;
      defender.vx = attacker.facing * (blocked ? 4 : heavy ? 11 : 6);
      if (heavy && !blocked) defender.vy = -5.5;

      if (!blocked) {
        attacker.comboCount += 1;
        s.hitStop = heavy ? 7 : 3;
        s.shake = heavy ? 14 : 6;
        if (heavy) arcadeAudio.heavyHit();
        else arcadeAudio.lightHit();
        spawnSparks(defender.x, defender.y - 72, attacker.def.glowColor, heavy ? 22 : 12, heavy ? 9.5 : 6.5);
        spawnSparks(defender.x, defender.y - 72, "#ffffff", 7, 5);
        spawnText(
          defender.x,
          defender.y - 115,
          heavy ? `-${dmg}!` : `-${dmg}`,
          heavy ? "#fde047" : "#fca5a5",
          heavy ? 1.35 : 1.05
        );
      } else {
        arcadeAudio.block();
        spawnSparks((attacker.x + defender.x) / 2, defender.y - 72, "#38bdf8", 16, 7);
        spawnText(defender.x, defender.y - 110, `CLASH -${dmg}`, "#7dd3fc", 1.05);
      }

      if (defender.hp <= 0) {
        defender.state = "ko";
        defender.vx = attacker.facing * 11;
        defender.vy = -9.5;
        attacker.state = "victory";
        s.hitStop = 14;
        s.shake = 20;
        s.matchWinner = attacker.slot;
        s.koText = attacker.hp === attacker.maxHp ? t("fightPerfect") : t("fightKO");
        arcadeAudio.ko();
      }
    };

    const stepSequence = () => {
      const s = simRef.current;
      const seq = s.sequence;
      if (!seq) return;

      const atk = seq.attacker === 1 ? s.p1 : s.p2;
      const def = seq.defender === 1 ? s.p1 : s.p2;
      seq.frame++;

      if (seq.type === "miss") {
        if (seq.frame === 12) {
          spawnText(STAGE_W / 2, GROUND_Y - 125, "MISS!", "#e2e8f0", 1.3);
          spawnSparks(STAGE_W / 2, GROUND_Y - 75, "#cbd5e1", 10, 4);
        }
      } else if (seq.type === "superWave") {
        // Charge aura -> Fire giant elemental Hadouken wave across the colosseum!
        if (seq.frame < 26) {
          atk.state = "special";
          if (seq.frame % 4 === 0) {
            spawnSparks(atk.x + atk.facing * 24, atk.y - 72, atk.def.glowColor, 5, 4);
          }
          if (seq.frame === 10) {
            spawnText(atk.x, atk.y - 135, atk.def.specialName, atk.def.glowColor, 1.35);
          }
        } else if (seq.frame === 26 && !seq.projectileFired) {
          seq.projectileFired = true;
          arcadeAudio.special();
          s.shake = 7;
          s.projectiles.push({
            owner: atk.slot,
            x: atk.x + atk.facing * 52,
            y: atk.y - 72,
            vx: atk.facing * 13.5,
            radius: 30,
            damage: seq.damage,
            color: atk.def.glowColor,
            accent: atk.def.accentColor,
            life: 90,
          });
          spawnSparks(atk.x + atk.facing * 48, atk.y - 72, atk.def.glowColor, 20, 7);
        } else if (seq.frame > 48 && atk.state === "special") {
          atk.state = "idle";
        }
      } else if (seq.type === "critCombo") {
        // 3-Hit Street Fighter Dash Combo!
        const targetX = def.homeX - atk.facing * 82;
        if (seq.frame <= 18) {
          atk.state = "dash";
          atk.x += (targetX - atk.x) * 0.28;
          if (seq.frame % 3 === 0) spawnSparks(atk.x, GROUND_Y, "#d6b888", 3, 2.5);
        } else if (seq.frame === 19) {
          atk.state = "light";
          atk.stateTimer = 14;
          arcadeAudio.slash();
        } else if (seq.frame === 25 && seq.hitsLanded === 0) {
          seq.hitsLanded = 1;
          dealDamageHit(atk, def, Math.round(seq.damage * 0.28), false, false);
        } else if (seq.frame === 38) {
          atk.state = "light";
          atk.stateTimer = 14;
          arcadeAudio.slash();
        } else if (seq.frame === 44 && seq.hitsLanded === 1 && def.hp > 0) {
          seq.hitsLanded = 2;
          dealDamageHit(atk, def, Math.round(seq.damage * 0.3), false, false);
        } else if (seq.frame === 58 && def.hp > 0) {
          atk.state = "heavy";
          atk.stateTimer = 24;
          arcadeAudio.slash();
        } else if (seq.frame === 68 && seq.hitsLanded === 2 && def.hp > 0) {
          seq.hitsLanded = 3;
          dealDamageHit(atk, def, Math.max(1, seq.damage - Math.round(seq.damage * 0.58)), true, false);
          spawnText(atk.x, atk.y - 140, `3 HIT ${t("fightCombo")}`, "#fde047", 1.25);
        } else if (seq.frame > 84 && def.hp > 0) {
          atk.state = "retreat";
          atk.x += (atk.homeX - atk.x) * 0.2;
          def.x += (def.homeX - def.x) * 0.14;
        }
      } else {
        // Normal Strike OR Blade Clash
        const targetX = seq.type === "clash" ? STAGE_W / 2 - atk.facing * 44 : def.homeX - atk.facing * 82;
        if (seq.frame <= 18) {
          atk.state = "dash";
          atk.x += (targetX - atk.x) * 0.26;
          if (seq.type === "clash") {
            const defTarget = STAGE_W / 2 + atk.facing * 44;
            def.state = "dash";
            def.x += (defTarget - def.x) * 0.26;
          }
          if (seq.frame % 4 === 0) spawnSparks(atk.x, GROUND_Y, "#d6b888", 3, 2.5);
        } else if (seq.frame === 19) {
          atk.state = "heavy";
          atk.stateTimer = 24;
          if (seq.type === "clash") def.state = "block";
          arcadeAudio.slash();
        } else if (seq.frame === 30 && seq.hitsLanded === 0) {
          seq.hitsLanded = 1;
          dealDamageHit(atk, def, seq.damage, seq.type !== "clash", seq.type === "clash");
        } else if (seq.frame > 56 && def.hp > 0) {
          atk.state = "retreat";
          atk.x += (atk.homeX - atk.x) * 0.18;
          def.x += (def.homeX - def.x) * 0.15;
        }
      }

      // Finish sequence
      if (seq.frame >= seq.duration) {
        s.sequence = null;
        if (s.matchWinner) {
          if (s.matchWinner === 1) {
            fetch("/api/stats/daily", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ win: true }),
            }).catch(() => {});
          }
          setBattlePhase("matchOver");
        } else {
          // Reset stances smoothly to home positions
          s.p1.x = s.p1.homeX;
          s.p2.x = s.p2.homeX;
          s.p1.state = "idle";
          s.p2.state = "idle";
          s.p1.comboCount = 0;
          s.p2.comboCount = 0;
          const nextSlot: 1 | 2 = gameMode === "2p" ? (activeTurn === 1 ? 2 : 1) : 1;
          fetchNextQuestion(nextSlot, turnNum + 1);
        }
      }
    };

    const step = () => {
      const s = simRef.current;
      if (!s.running) return;
      frameTick++;

      if (s.shake > 0) s.shake *= 0.84;
      if (s.shake < 0.3) s.shake = 0;

      if (s.hitStop > 0) {
        s.hitStop--;
      } else {
        stepSequence();

        for (const f of [s.p1, s.p2]) {
          f.animTime++;
          if (f.hitFlash > 0) f.hitFlash--;
          if (f.stateTimer > 0) {
            f.stateTimer--;
            if (f.stateTimer === 0 && (f.state === "hitstun" || f.state === "light" || f.state === "heavy" || f.state === "block")) {
              if (f.hp > 0) f.state = "idle";
            }
          }
          if (f.displayHp > f.hp) {
            f.displayHp = Math.max(f.hp, f.displayHp - 0.65);
          }

          // Gravity & knockback physics
          f.vy += 0.9;
          f.x += f.vx;
          f.y += f.vy;
          if (f.y >= GROUND_Y) {
            f.y = GROUND_Y;
            f.vy = 0;
          }
          f.vx *= 0.82;
          f.x = Math.max(70, Math.min(STAGE_W - 70, f.x));
        }

        // Update Super Wave projectiles
        for (let i = s.projectiles.length - 1; i >= 0; i--) {
          const p = s.projectiles[i];
          p.x += p.vx;
          p.life--;
          if (frameTick % 2 === 0) {
            s.particles.push({
              x: p.x - Math.sign(p.vx) * 14,
              y: p.y + (Math.random() - 0.5) * 18,
              vx: -p.vx * 0.14,
              vy: (Math.random() - 0.5) * 2,
              life: 16,
              maxLife: 16,
              size: 6,
              color: p.color,
            });
          }
          const attacker = p.owner === 1 ? s.p1 : s.p2;
          const target = p.owner === 1 ? s.p2 : s.p1;
          if (Math.abs(p.x - target.x) < p.radius + 26) {
            dealDamageHit(attacker, target, p.damage, true, false);
            s.projectiles.splice(i, 1);
            continue;
          }
          if (p.life <= 0 || p.x < -60 || p.x > STAGE_W + 60) {
            s.projectiles.splice(i, 1);
          }
        }

        // Particles & Floating Texts
        for (let i = s.particles.length - 1; i >= 0; i--) {
          const pt = s.particles[i];
          pt.x += pt.vx;
          pt.y += pt.vy;
          pt.vy += 0.18;
          pt.life--;
          if (pt.life <= 0) s.particles.splice(i, 1);
        }
        for (let i = s.texts.length - 1; i >= 0; i--) {
          const tx = s.texts[i];
          tx.y += tx.vy;
          tx.life--;
          if (tx.life <= 0) s.texts.splice(i, 1);
        }
      }

      drawFrame();

      if (frameTick % 3 === 0) {
        setHud({
          p1Hp: s.p1.hp,
          p1DisplayHp: s.p1.displayHp,
          p1MaxHp: s.p1.maxHp,
          p1Super: Math.floor(s.p1.superMeter),
          p1Combo: s.p1.comboCount,
          p2Hp: s.p2.hp,
          p2DisplayHp: s.p2.displayHp,
          p2MaxHp: s.p2.maxHp,
          p2Super: Math.floor(s.p2.superMeter),
          p2Combo: s.p2.comboCount,
          matchWinner: s.matchWinner,
          koText: s.koText,
        });
      }

      rafId = requestAnimationFrame(step);
    };

    const drawFighter = (ctx: CanvasRenderingContext2D, f: FighterEntity) => {
      ctx.save();
      const bob = f.state === "idle" ? Math.sin(f.animTime * 0.11) * 3.2 : 0;
      const stride = f.state === "dash" || f.state === "retreat" ? Math.sin(f.animTime * 0.45) * 16 : 0;
      const crouchOffset = f.state === "block" ? 16 : 0;

      // Ground shadow
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.beginPath();
      const shadowScale = Math.max(0.45, 1 - (GROUND_Y - f.y) / 260);
      ctx.ellipse(f.x, GROUND_Y + 6, 44 * shadowScale, 11 * shadowScale, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.translate(f.x, f.y + crouchOffset);
      ctx.scale(f.facing, 1);

      if (f.state === "ko") {
        ctx.translate(0, -18);
        ctx.rotate(-Math.PI / 2.2);
      } else if (f.state === "hitstun") {
        ctx.rotate(-0.22);
      } else if (f.state === "dash") {
        ctx.rotate(0.14);
      }

      // Super aura when full meter or unleashing special
      if (f.superMeter >= 100 || f.state === "special") {
        const pulse = 0.32 + Math.sin(f.animTime * 0.22) * 0.15;
        const grad = ctx.createRadialGradient(0, -68, 12, 0, -68, 78);
        grad.addColorStop(0, `${f.def.glowColor}aa`);
        grad.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = grad;
        ctx.globalAlpha = pulse + 0.35;
        ctx.beginPath();
        ctx.arc(0, -68, 78, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      const flash = f.hitFlash > 0 && f.hitFlash % 2 === 0;
      const steelGrad = ctx.createLinearGradient(-16, -125, 18, -50);
      steelGrad.addColorStop(0, "#f8fafc");
      steelGrad.addColorStop(0.45, f.def.secondaryColor);
      steelGrad.addColorStop(1, "#334155");

      const armorGrad = ctx.createLinearGradient(-20, -100, 20, -40);
      armorGrad.addColorStop(0, f.def.primaryColor);
      armorGrad.addColorStop(0.65, f.def.capeColor);
      armorGrad.addColorStop(1, "#0f0a14");

      // Flowing medieval cloak
      const capeWave = Math.sin(f.animTime * 0.18) * 9 - (f.state === "dash" ? 16 : 0);
      const capeGrad = ctx.createLinearGradient(-38, -95, -4, -10);
      capeGrad.addColorStop(0, f.def.primaryColor);
      capeGrad.addColorStop(1, f.def.capeColor);
      ctx.fillStyle = flash ? "#ffffff" : capeGrad;
      ctx.strokeStyle = "#180d0b";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-10, -98 + bob);
      ctx.quadraticCurveTo(-40 + capeWave, -58, -36 + capeWave * 1.4, -10);
      ctx.lineTo(-18 + capeWave * 0.7, -15);
      ctx.lineTo(-4, -24);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Articulated Armored Legs
      const drawLeg = (hipX: number, footX: number, shade: string) => {
        const kneeX = (hipX + footX) / 2 + 5;
        const kneeY = -25 + bob * 0.4;
        ctx.strokeStyle = "#0b0f19";
        ctx.lineWidth = 14;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(hipX, -44 + bob);
        ctx.lineTo(kneeX, kneeY);
        ctx.lineTo(footX, -7);
        ctx.stroke();

        ctx.strokeStyle = flash ? "#ffffff" : shade;
        ctx.lineWidth = 9.5;
        ctx.beginPath();
        ctx.moveTo(hipX, -44 + bob);
        ctx.lineTo(kneeX, kneeY);
        ctx.lineTo(footX, -7);
        ctx.stroke();

        ctx.fillStyle = flash ? "#ffffff" : "#f5cb6e";
        ctx.beginPath();
        ctx.arc(kneeX, kneeY, 4.5, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = flash ? "#ffffff" : steelGrad;
        ctx.strokeStyle = "#0f172a";
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.roundRect(footX - 7, -11, 20, 11, [4, 7, 2, 2]);
        ctx.fill();
        ctx.stroke();
      };

      drawLeg(-7, -15 - stride, "#334155");
      drawLeg(8, 15 + stride, "#475569");

      // Tassets & Cuirass
      ctx.fillStyle = flash ? "#ffffff" : armorGrad;
      ctx.strokeStyle = "#d4a147";
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(-18, -50 + bob);
      ctx.lineTo(18, -50 + bob);
      ctx.lineTo(22, -33 + bob);
      ctx.lineTo(-22, -33 + bob);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = flash ? "#ffffff" : armorGrad;
      ctx.strokeStyle = "#e6b85c";
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(-21, -96 + bob);
      ctx.lineTo(21, -96 + bob);
      ctx.lineTo(16, -48 + bob);
      ctx.lineTo(-16, -48 + bob);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = flash ? "#ffffff" : "#78350f";
      ctx.fillRect(-17, -53 + bob, 34, 6);
      ctx.fillStyle = flash ? "#ffffff" : "#f5cb6e";
      ctx.fillRect(-5, -55 + bob, 10, 9);
      ctx.fillStyle = flash ? "#ffffff" : f.def.accentColor;
      ctx.beginPath();
      ctx.moveTo(0, -88 + bob);
      ctx.lineTo(7, -75 + bob);
      ctx.lineTo(0, -61 + bob);
      ctx.lineTo(-7, -75 + bob);
      ctx.closePath();
      ctx.fill();

      // Back Pauldron
      ctx.fillStyle = flash ? "#ffffff" : steelGrad;
      ctx.strokeStyle = "#d4a147";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(-16, -89 + bob, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Headgear per Fighter Class
      ctx.fillStyle = flash ? "#ffffff" : steelGrad;
      ctx.strokeStyle = "#0f172a";
      ctx.lineWidth = 2;
      if (f.def.id === "vex") {
        ctx.fillStyle = flash ? "#ffffff" : "#2e1065";
        ctx.beginPath();
        ctx.arc(1, -115 + bob, 18, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "#09060f";
        ctx.beginPath();
        ctx.arc(6, -114 + bob, 11, -1.1, 1.1);
        ctx.fill();
        ctx.fillStyle = "#e879f9";
        ctx.fillRect(9, -117 + bob, 6, 3.5);
      } else {
        ctx.beginPath();
        ctx.roundRect(-14, -133 + bob, 31, 32, [14, 14, 7, 7]);
        ctx.fill();
        ctx.stroke();
        ctx.strokeStyle = "#f5cb6e";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(2, -133 + bob);
        ctx.lineTo(2, -101 + bob);
        ctx.stroke();
        ctx.fillStyle = "#090d16";
        ctx.fillRect(3, -120 + bob, 15, 7);
        ctx.fillStyle = f.def.glowColor;
        ctx.fillRect(8, -118 + bob, 8, 3.5);
      }

      // Helm Crest
      ctx.fillStyle = flash ? "#ffffff" : f.def.primaryColor;
      ctx.strokeStyle = "#f5cb6e";
      ctx.lineWidth = 1.5;
      if (f.def.id === "lyra") {
        ctx.fillStyle = flash ? "#ffffff" : "#e0f2fe";
        ctx.beginPath();
        ctx.moveTo(-4, -125 + bob);
        ctx.lineTo(-26, -142 + bob);
        ctx.lineTo(-14, -122 + bob);
        ctx.lineTo(-24, -116 + bob);
        ctx.lineTo(-2, -114 + bob);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else if (f.def.id === "brutus") {
        ctx.fillStyle = flash ? "#ffffff" : "#facc15";
        ctx.beginPath();
        ctx.moveTo(-10, -131 + bob);
        ctx.lineTo(-15, -146 + bob);
        ctx.lineTo(-2, -135 + bob);
        ctx.lineTo(4, -149 + bob);
        ctx.lineTo(10, -133 + bob);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.moveTo(-2, -132 + bob);
        ctx.quadraticCurveTo(-24, -145 + bob, -32 + capeWave * 0.45, -118 + bob);
        ctx.quadraticCurveTo(-14, -124 + bob, 6, -129 + bob);
        ctx.fill();
      }

      // Front Pauldron
      ctx.fillStyle = flash ? "#ffffff" : steelGrad;
      ctx.strokeStyle = "#f5cb6e";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(12, -88 + bob, 14, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Weapon Arm
      ctx.save();
      ctx.translate(14, -82 + bob);

      let armAngle = -0.32 + Math.sin(f.animTime * 0.08) * 0.05;
      if (f.state === "light") {
        const p = 1 - f.stateTimer / 14;
        armAngle = -1.3 + p * 2.3;
      } else if (f.state === "heavy") {
        const p = 1 - f.stateTimer / 24;
        armAngle = p < 0.32 ? -2.2 : -1.9 + ((p - 0.32) / 0.68) * 3.3;
      } else if (f.state === "special") {
        armAngle = 0.05;
      } else if (f.state === "victory") {
        armAngle = -1.45;
      } else if (f.state === "block") {
        armAngle = -0.75;
      }

      ctx.rotate(armAngle);

      ctx.fillStyle = flash ? "#ffffff" : steelGrad;
      ctx.strokeStyle = "#0f172a";
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.roundRect(-2, -5, 22, 10, 4);
      ctx.fill();
      ctx.stroke();

      if (f.def.weapon === "sword") {
        ctx.fillStyle = "#f5cb6e";
        ctx.strokeStyle = "#78350f";
        ctx.fillRect(16, -11, 6, 22);
        ctx.strokeRect(16, -11, 6, 22);
        const bladeGrad = ctx.createLinearGradient(22, -5, 86, 5);
        bladeGrad.addColorStop(0, "#e2e8f0");
        bladeGrad.addColorStop(0.5, "#ffffff");
        bladeGrad.addColorStop(1, "#94a3b8");
        ctx.fillStyle = bladeGrad;
        ctx.beginPath();
        ctx.moveTo(22, -5);
        ctx.lineTo(74, -4);
        ctx.lineTo(86, 0);
        ctx.lineTo(74, 4);
        ctx.lineTo(22, 5);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = "#1e293b";
        ctx.stroke();
        ctx.fillStyle = f.def.glowColor;
        ctx.fillRect(24, -1.3, 50, 2.6);
      } else if (f.def.weapon === "spear") {
        ctx.fillStyle = "#78350f";
        ctx.fillRect(-12, -3, 82, 6);
        ctx.fillStyle = "#f5cb6e";
        ctx.fillRect(64, -5, 6, 10);
        ctx.fillStyle = "#e0f2fe";
        ctx.strokeStyle = "#0284c7";
        ctx.beginPath();
        ctx.moveTo(70, -8);
        ctx.lineTo(98, 0);
        ctx.lineTo(70, 8);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else if (f.def.weapon === "hammer") {
        ctx.fillStyle = "#713f12";
        ctx.fillRect(0, -3.5, 56, 7);
        const hamGrad = ctx.createLinearGradient(48, -20, 78, 20);
        hamGrad.addColorStop(0, "#fef08a");
        hamGrad.addColorStop(0.5, "#f59e0b");
        hamGrad.addColorStop(1, "#92400e");
        ctx.fillStyle = hamGrad;
        ctx.strokeStyle = "#fef3c7";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(48, -20, 30, 40, 5);
        ctx.fill();
        ctx.stroke();
      } else {
        ctx.fillStyle = "#f8fafc";
        ctx.strokeStyle = "#6b21a8";
        ctx.beginPath();
        ctx.moveTo(16, -6);
        ctx.lineTo(62, -1);
        ctx.lineTo(16, 4);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = f.def.glowColor;
        ctx.fillRect(20, -2, 34, 2.5);
      }

      ctx.restore();

      // Dramatic slash arc ONLY during animated attack sequence frames
      if (
        (f.state === "light" && f.stateTimer <= 10 && f.stateTimer >= 3) ||
        (f.state === "heavy" && f.stateTimer <= 16 && f.stateTimer >= 5)
      ) {
        ctx.strokeStyle = f.def.glowColor;
        ctx.lineWidth = f.state === "heavy" ? 12 : 6;
        ctx.globalAlpha = 0.85;
        ctx.beginPath();
        ctx.arc(16, -74, f.def.stats.reach * 0.9, -1.25, 0.85);
        ctx.stroke();
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(16, -74, f.def.stats.reach * 0.9, -1.1, 0.7);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // Shield flash when blocking a clash
      if (f.state === "block") {
        ctx.strokeStyle = "#38bdf8";
        ctx.fillStyle = "rgba(56, 189, 248, 0.28)";
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(26, -68, 38, -1.25, 1.25);
        ctx.stroke();
        ctx.fill();
      }

      ctx.restore();
    };

    const drawFrame = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const s = simRef.current;

      ctx.save();
      if (s.shake > 0) {
        ctx.translate((Math.random() - 0.5) * s.shake, (Math.random() - 0.5) * s.shake);
      }

      if (stageImgRef.current) {
        ctx.drawImage(stageImgRef.current, -12, -8, STAGE_W + 24, STAGE_H + 16);
        const vig = ctx.createLinearGradient(0, 0, 0, STAGE_H);
        vig.addColorStop(0, "rgba(8,6,12,0.58)");
        vig.addColorStop(0.35, "rgba(8,6,12,0.14)");
        vig.addColorStop(0.82, "rgba(8,6,12,0.28)");
        vig.addColorStop(1, "rgba(8,6,12,0.72)");
        ctx.fillStyle = vig;
        ctx.fillRect(0, 0, STAGE_W, STAGE_H);
      } else {
        ctx.fillStyle = "#1a1118";
        ctx.fillRect(0, 0, STAGE_W, STAGE_H);
      }

      // Subtle gilded floor combat line
      ctx.strokeStyle = "rgba(245, 200, 100, 0.28)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(40, GROUND_Y + 6);
      ctx.lineTo(STAGE_W - 40, GROUND_Y + 6);
      ctx.stroke();

      drawFighter(ctx, s.p1);
      drawFighter(ctx, s.p2);

      // Projectiles
      for (const p of s.projectiles) {
        const grad = ctx.createRadialGradient(p.x, p.y, 4, p.x, p.y, p.radius * 1.6);
        grad.addColorStop(0, "#ffffff");
        grad.addColorStop(0.45, p.accent);
        grad.addColorStop(0.8, p.color);
        grad.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius * 1.6, 0, Math.PI * 2);
        ctx.fill();
      }

      // Particles
      for (const pt of s.particles) {
        ctx.globalAlpha = Math.max(0, pt.life / pt.maxLife);
        ctx.fillStyle = pt.color;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, pt.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // Floating damage/combo callouts
      for (const tx of s.texts) {
        ctx.save();
        ctx.globalAlpha = Math.min(1, tx.life / 16);
        ctx.font = `800 ${Math.round(20 * tx.scale)}px Cinzel, Georgia, serif`;
        ctx.textAlign = "center";
        ctx.lineWidth = 4;
        ctx.strokeStyle = "#09060c";
        ctx.strokeText(tx.text, tx.x, tx.y);
        ctx.fillStyle = tx.color;
        ctx.fillText(tx.text, tx.x, tx.y);
        ctx.restore();
      }

      ctx.restore();
    };

    rafId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafId);
  }, [screen, activeTurn, turnNum, gameMode, fetchNextQuestion, t]);

  const p1Def = FIGHTERS[p1Idx];
  const p2Def = FIGHTERS[p2Idx];

  return (
    <div className="arena-backdrop min-h-screen w-full px-3 sm:px-6 py-4 flex flex-col items-center">
      <InviteToast />
      {/* Top Bar */}
      <header className="w-full max-w-[1100px] flex flex-wrap items-center justify-between gap-3 mb-4">
        <Link
          href="/"
          className="royal-panel hover:border-[#f5cd71] rounded-xl px-4 py-2 text-xs font-cinzel font-bold tracking-wider text-[#f7e1b0] hover:text-white transition-all"
        >
          ← {t("fightBackLobby")}
        </Link>

        <div className="text-center royal-panel rounded-2xl px-6 py-2">
          <h1 className="font-cinzel font-extrabold text-xl sm:text-2xl tracking-[0.14em] gold-title leading-none">
            ⚔ {t("fightTitle")}
          </h1>
          <p className="text-[0.7rem] text-[#e8d3aa] hidden sm:block mt-0.5">{t("fightSubtitle")}</p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setSoundOn((v) => !v)}
            className="royal-panel rounded-xl px-3 py-1.5 text-xs font-cinzel text-[#f7e1b0] hover:border-[#f5cd71] cursor-pointer"
          >
            {soundOn ? `🔊 ${t("fightSoundOn")}` : `🔇 ${t("fightSoundOff")}`}
          </button>
          <ThemeSwitcher compact />
          <LanguageSwitcher compact />
        </div>
      </header>

      {/* ==================== FIGHTER SELECT SCREEN ==================== */}
      {screen === "select" && (
        <div className="w-full max-w-[1100px] flex flex-col gap-5">
          {/* Mode + Difficulty Bar */}
          <div className="royal-panel rounded-2xl p-4 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setGameMode("1p")}
                className={`px-4 py-2 rounded-xl font-cinzel font-bold text-xs tracking-wider cursor-pointer border transition-all ${
                  gameMode === "1p"
                    ? "btn-crimson border-[#f5cd71]"
                    : "bg-[#120e1a] border-[#7a5828] text-[#dfc99e] hover:border-[#d4a147]"
                }`}
              >
                🤖 {t("fightMode1P")}
              </button>
              <button
                type="button"
                onClick={() => setGameMode("2p")}
                className={`px-4 py-2 rounded-xl font-cinzel font-bold text-xs tracking-wider cursor-pointer border transition-all ${
                  gameMode === "2p"
                    ? "btn-crimson border-[#f5cd71]"
                    : "bg-[#120e1a] border-[#7a5828] text-[#dfc99e] hover:border-[#d4a147]"
                }`}
              >
                👥 {t("fightMode2P")}
              </button>
            </div>

            {gameMode === "1p" && (
              <div className="flex items-center gap-2 text-xs font-cinzel text-[#e6c98e]">
                <span className="uppercase tracking-wider">{t("fightDiffLabel")}:</span>
                {(["easy", "medium", "hard"] as const).map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setAiDiff(d)}
                    className={`px-3 py-1.5 rounded-lg border font-bold cursor-pointer transition-all ${
                      aiDiff === d
                        ? "btn-sapphire border-[#f5cd71]"
                        : "bg-[#120e1a] border-[#7a5828] text-[#dfc99e]"
                    }`}
                  >
                    {d === "easy"
                      ? t("fightDiffEasy")
                      : d === "medium"
                      ? t("fightDiffMedium")
                      : t("fightDiffHard")}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Twin Fighter Selection */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {([1, 2] as const).map((slot) => {
              const selectedIdx = slot === 1 ? p1Idx : p2Idx;
              const setSelected = slot === 1 ? setP1Idx : setP2Idx;
              const cur = FIGHTERS[selectedIdx];
              return (
                <div key={slot} className="royal-panel rounded-2xl p-4 sm:p-5 flex flex-col gap-4">
                  <div className="flex items-center justify-between border-b border-[#b68635]/40 pb-2">
                    <span className="font-cinzel font-extrabold text-sm tracking-[0.14em] uppercase text-[#ffd977]">
                      {slot === 1 ? `🛡 ${t("fightSelectP1")}` : `⚔ ${t("fightSelectP2")}`}
                    </span>
                    <span className="text-xs font-cinzel text-[#f3dfb4] bg-[#1a1324] border border-[#b68635]/60 rounded-full px-3 py-0.5">
                      {cur.specialName}
                    </span>
                  </div>

                  <div className="flex items-center gap-4 bg-[#0f0b17]/80 border border-[#8e672b]/60 rounded-xl p-3">
                    <img
                      src={cur.portrait}
                      alt={cur.name}
                      className="w-22 h-22 rounded-xl object-cover border-2 border-[#f3ca6b] shadow-lg shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="font-cinzel font-extrabold text-lg gold-title truncate">{cur.name}</div>
                      <div className="text-xs text-[#cbb384] mb-2">
                        {lang === "ro" ? cur.titleRo : cur.titleEn}
                      </div>
                      <div className="flex flex-col gap-1.5 text-[0.68rem]">
                        {[
                          { label: "ATK", val: cur.rating.atk, col: "from-red-600 to-amber-400" },
                          { label: "SPD", val: cur.rating.spd, col: "from-sky-500 to-cyan-300" },
                          { label: "DEF", val: cur.rating.def, col: "from-amber-600 to-yellow-300" },
                        ].map((st) => (
                          <div key={st.label} className="flex items-center gap-2">
                            <span className="w-7 font-cinzel font-bold text-[#e5cfa3]">{st.label}</span>
                            <div className="flex-1 h-2 bg-[#1b1526] rounded-full overflow-hidden">
                              <div className={`h-full bg-gradient-to-r ${st.col}`} style={{ width: `${st.val}%` }} />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-4 gap-2.5">
                    {FIGHTERS.map((f, i) => {
                      const active = i === selectedIdx;
                      return (
                        <button
                          key={f.id}
                          type="button"
                          onClick={() => setSelected(i)}
                          className={`relative rounded-xl overflow-hidden border-2 transition-all cursor-pointer aspect-square ${
                            active
                              ? "border-[#ffe38a] scale-105 shadow-[0_0_18px_rgba(255,215,96,0.55)]"
                              : "border-[#6e4e20] opacity-75 hover:opacity-100 hover:border-[#d4a147]"
                          }`}
                        >
                          <img src={f.portrait} alt={f.name} className="w-full h-full object-cover" />
                          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent p-1 text-center">
                            <span className="font-cinzel font-bold text-[0.62rem] text-[#fff2cc] block truncate">
                              {f.name.split(" ")[0]}
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Online Invite & Bot Fill Lobby */}
          <MatchLobby
            gameType="fight"
            maxSeats={2}
            botDifficulty={aiDiff}
            onDifficultyChange={setAiDiff}
            initialRoomCode={initialRoom}
            onSeatsChange={(s, r) => {
              setLobbySeats(s);
              setLobbyRoom(r);
            }}
          />

          <div className="flex flex-col items-center gap-3">
            <button
              type="button"
              onClick={async () => {
                if (gameMode === "1p" && lobbySeats.length < 2 && lobbyRoom) {
                  await fetch("/api/rooms", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ action: "fillBots", code: lobbyRoom.code, difficulty: aiDiff }),
                  }).catch(() => {});
                }
                launchMatch();
              }}
              className="btn-crimson rounded-2xl px-14 py-4 font-cinzel font-extrabold text-xl tracking-[0.2em] uppercase cursor-pointer animate-gold-glow"
            >
              ⚔ {t("fightStartMatch")} ⚔
            </button>
            <p className="royal-panel rounded-xl px-5 py-2.5 text-center text-xs text-[#e3cba0] max-w-2xl">
              {t("fightHowItWorks")}
            </p>
          </div>
        </div>
      )}

      {/* ==================== LIVE QUIZ FIGHTER ARENA ==================== */}
      {screen === "battle" && (
        <div className="w-full max-w-[980px] flex flex-col gap-3.5">
          {/* Street Fighter Arena Stage + Health/Super HUD */}
          <div className="relative rounded-2xl overflow-hidden border-[3px] border-[#d4a147] shadow-[0_18px_50px_rgba(0,0,0,0.85)] bg-black">
            {/* TOP STREET FIGHTER HUD */}
            <div className="absolute top-0 inset-x-0 z-20 p-2.5 sm:p-4 pointer-events-none">
              <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-2 sm:gap-4">
                {/* P1 Health + Super */}
                <div className="flex items-center gap-2 sm:gap-3">
                  <img
                    src={p1Def.portrait}
                    alt={p1Def.name}
                    className="w-11 h-11 sm:w-14 sm:h-14 rounded-full object-cover border-2 border-[#f3ca6b] shadow-lg shrink-0"
                  />
                  <div className="flex-1 flex flex-col gap-1">
                    <div className="flex items-center justify-between text-[0.7rem] sm:text-xs font-cinzel font-bold">
                      <span className="text-[#ffefc8] drop-shadow">{p1Def.name}</span>
                      <span className="text-[#fde047]">{hud.p1Hp}/{hud.p1MaxHp}</span>
                    </div>
                    <div className="h-4 sm:h-5 bg-[#120b14]/90 border-2 border-[#d4a147] rounded-md overflow-hidden relative">
                      <div
                        className="absolute inset-y-0 left-0 bg-red-600 transition-all duration-100"
                        style={{ width: `${(hud.p1DisplayHp / hud.p1MaxHp) * 100}%` }}
                      />
                      <div
                        className="absolute inset-y-0 left-0 bg-gradient-to-b from-[#4ade80] via-[#22c55e] to-[#15803d]"
                        style={{ width: `${(hud.p1Hp / hud.p1MaxHp) * 100}%` }}
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-2 bg-[#0e0a14]/90 border border-[#8e672b] rounded-full overflow-hidden">
                        <div
                          className={`h-full transition-all ${
                            hud.p1Super >= 100
                              ? "bg-gradient-to-r from-[#f59e0b] via-[#fde047] to-[#ffffff]"
                              : "bg-gradient-to-r from-[#1d4ed8] to-[#38bdf8]"
                          }`}
                          style={{ width: `${hud.p1Super}%` }}
                        />
                      </div>
                      {hud.p1Super >= 100 && (
                        <span className="text-[0.58rem] font-cinzel font-extrabold text-[#fde047] animate-pulse">
                          {t("fightSuperReady")}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Center Turn / Timer Medallion */}
                <div className="royal-panel rounded-xl px-3 sm:px-4 py-1.5 text-center min-w-[70px]">
                  <div className="text-[0.58rem] font-cinzel text-[#d8bc88] uppercase">
                    {t("fightRound")} {turnNum}
                  </div>
                  <div
                    className={`font-cinzel font-extrabold text-xl sm:text-2xl leading-none ${
                      battlePhase === "question" && timeLeft <= 3 ? "text-red-400 animate-pulse" : "gold-title"
                    }`}
                  >
                    {battlePhase === "question" ? Math.ceil(timeLeft) : "⚔"}
                  </div>
                </div>

                {/* P2 Health + Super */}
                <div className="flex items-center gap-2 sm:gap-3 flex-row-reverse">
                  <img
                    src={p2Def.portrait}
                    alt={p2Def.name}
                    className="w-11 h-11 sm:w-14 sm:h-14 rounded-full object-cover border-2 border-[#f3ca6b] shadow-lg shrink-0"
                  />
                  <div className="flex-1 flex flex-col gap-1">
                    <div className="flex items-center justify-between flex-row-reverse text-[0.7rem] sm:text-xs font-cinzel font-bold">
                      <span className="text-[#ffefc8] drop-shadow">{p2Def.name}</span>
                      <span className="text-[#fde047]">{hud.p2Hp}/{hud.p2MaxHp}</span>
                    </div>
                    <div className="h-4 sm:h-5 bg-[#120b14]/90 border-2 border-[#d4a147] rounded-md overflow-hidden relative">
                      <div
                        className="absolute inset-y-0 right-0 bg-red-600 transition-all duration-100"
                        style={{ width: `${(hud.p2DisplayHp / hud.p2MaxHp) * 100}%` }}
                      />
                      <div
                        className="absolute inset-y-0 right-0 bg-gradient-to-b from-[#4ade80] via-[#22c55e] to-[#15803d]"
                        style={{ width: `${(hud.p2Hp / hud.p2MaxHp) * 100}%` }}
                      />
                    </div>
                    <div className="flex items-center gap-2 flex-row-reverse">
                      <div className="flex-1 h-2 bg-[#0e0a14]/90 border border-[#8e672b] rounded-full overflow-hidden">
                        <div
                          className={`h-full ml-auto transition-all ${
                            hud.p2Super >= 100
                              ? "bg-gradient-to-l from-[#f59e0b] via-[#fde047] to-[#ffffff]"
                              : "bg-gradient-to-l from-[#1d4ed8] to-[#38bdf8]"
                          }`}
                          style={{ width: `${hud.p2Super}%` }}
                        />
                      </div>
                      {hud.p2Super >= 100 && (
                        <span className="text-[0.58rem] font-cinzel font-extrabold text-[#fde047] animate-pulse">
                          {t("fightSuperReady")}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Attack Sequence Result Banner (visible during animated strike!) */}
            {battlePhase === "attacking" && outcomeBanner && !hud.matchWinner && (
              <div className="absolute top-22 inset-x-0 z-20 flex flex-col items-center pointer-events-none px-4 text-center">
                <div
                  className={`px-5 py-1.5 rounded-xl border-2 font-cinzel font-extrabold text-xs sm:text-sm tracking-wider shadow-2xl ${
                    outcomeBanner.tone === "super"
                      ? "bg-amber-950/90 border-yellow-400 text-yellow-200"
                      : outcomeBanner.tone === "good"
                      ? "bg-emerald-950/90 border-emerald-400 text-emerald-200"
                      : outcomeBanner.tone === "bad"
                      ? "bg-rose-950/90 border-rose-400 text-rose-200"
                      : "bg-slate-900/90 border-sky-400 text-sky-200"
                  }`}
                >
                  {outcomeBanner.headline}
                </div>
                <div className="mt-1 bg-black/75 border border-[#b68635]/60 rounded-lg px-3 py-0.5 text-[0.72rem] text-[#f5dfb4] flex items-center gap-2">
                  <span>
                    {t("fightAnswerWas")} <strong className="text-[#ffe28a]">{outcomeBanner.correctAnswer}</strong>
                  </span>
                  <span className="font-mono text-sky-300">{outcomeBanner.timeSummary}</span>
                </div>
              </div>
            )}

            {/* Match Victory / KO Overlay */}
            {battlePhase === "matchOver" && hud.matchWinner && (
              <div className="absolute inset-0 z-30 bg-black/55 flex flex-col items-center justify-center px-4 text-center">
                <div className="font-cinzel font-extrabold text-5xl sm:text-6xl tracking-[0.14em] gold-title">
                  {hud.koText || t("fightKO")}
                </div>
                <div className="crimson-ribbon mt-2 px-8 py-1.5 font-cinzel font-bold text-sm sm:text-lg tracking-[0.18em] text-[#fff6dc]">
                  {hud.matchWinner === 1 ? p1Def.name : p2Def.name} — {t("fightWinsMatch")}
                </div>
                <div className="flex gap-3 mt-6">
                  <button
                    type="button"
                    onClick={launchMatch}
                    className="btn-crimson rounded-xl px-6 py-3 font-cinzel font-bold text-xs sm:text-sm tracking-wider uppercase cursor-pointer"
                  >
                    ⚔ {t("fightRematch")}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      clearQTimer();
                      simRef.current.running = false;
                      setScreen("select");
                    }}
                    className="btn-sapphire rounded-xl px-6 py-3 font-cinzel font-bold text-xs sm:text-sm tracking-wider uppercase cursor-pointer"
                  >
                    {t("fightChangeFighters")}
                  </button>
                </div>
              </div>
            )}

            {/* 60FPS HTML5 Arena Canvas */}
            <canvas
              ref={canvasRef}
              width={STAGE_W}
              height={STAGE_H}
              className="w-full h-auto block select-none"
            />
          </div>

          {/* ==================== TRIVIA STRIKE PANEL (Triggers Attack Sequences!) ==================== */}
          <div className="royal-panel rounded-2xl p-4 sm:p-5 flex flex-col gap-3">
            {battlePhase === "loading" && (
              <div className="py-6 text-center font-cinzel text-[#f7d279] text-sm">
                ⏳ {t("trainLoading")}
              </div>
            )}

            {battlePhase === "attacking" && (
              <div className="py-4 text-center flex flex-col items-center gap-1.5">
                <span className="font-cinzel font-extrabold text-base sm:text-lg gold-title">
                  ⚔ {outcomeBanner?.headline}
                </span>
                <div className="flex flex-wrap items-center justify-center gap-2 text-xs text-[#d6be92]">
                  <span>
                    {t("fightAnswerWas")} <strong className="text-[#ffe28a]">{outcomeBanner?.correctAnswer}</strong>
                  </span>
                  {outcomeBanner?.timeSummary && (
                    <span className="font-mono text-sky-300 bg-[#0d1424]/90 border border-sky-400/50 rounded-md px-2 py-0.5">
                      {outcomeBanner.timeSummary}
                    </span>
                  )}
                </div>
              </div>
            )}

            {battlePhase === "matchOver" && (
              <div className="py-2 text-center text-xs font-cinzel text-[#e6c98e]">
                {t("fightTitle")} — {hud.matchWinner === 1 ? p1Def.name : p2Def.name} 🏆
              </div>
            )}

            {battlePhase === "question" && question && (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="font-cinzel font-bold text-[#ffd977] tracking-wider uppercase">
                    ⚔ {gameMode === "2p" ? (activeTurn === 1 ? t("fightTurnP1") : t("fightTurnP2")) : t("fightQuestionLabel")}
                    {question.category ? ` • ${question.category}` : ""}
                  </span>
                  <span className="text-[#d6be92] text-[0.72rem]">{t("fightAnswerPrompt")}</span>
                </div>

                {/* Speed Bonus Progress Bar */}
                <div className="h-2 bg-[#0d0a12] rounded-full overflow-hidden border border-[#8e672b]/60">
                  <div
                    className={`h-full transition-all duration-100 ${
                      timeLeft <= 3
                        ? "bg-gradient-to-r from-red-600 to-rose-400"
                        : timeLeft >= QUESTION_SECONDS - 4.5
                        ? "bg-gradient-to-r from-[#f59e0b] via-[#fde047] to-[#fff5b8]"
                        : "bg-gradient-to-r from-[#2563eb] to-[#38bdf8]"
                    }`}
                    style={{ width: `${(timeLeft / QUESTION_SECONDS) * 100}%` }}
                  />
                </div>

                {/* Parchment Question Scroll */}
                <div className="parchment-panel rounded-xl px-4 py-3.5">
                  <p className="font-cinzel font-bold text-sm sm:text-base text-[#241306] leading-snug">
                    {question.prompt}
                  </p>
                </div>

                {/* 4 Attack Answer Tiles */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {question.options.map((opt, idx) => (
                    <button
                      key={idx}
                      type="button"
                      disabled={selectedOpt !== null}
                      onClick={() => {
                        const elapsed = (Date.now() - questionStartRef.current) / 1000;
                        triggerResolution(question, idx, elapsed, activeTurn);
                      }}
                      className="bg-[#130f1c]/95 border-2 border-[#8c6429] hover:border-[#ffe28a] hover:bg-[#231932] rounded-xl text-left px-4 py-3 text-sm font-medium text-[#f6ead0] cursor-pointer transition-all flex items-start gap-2.5"
                    >
                      <span className="inline-flex items-center gap-1 shrink-0">
                        <kbd className="px-1.5 py-0.5 text-[0.65rem] font-mono font-bold rounded bg-[#0c0912] border border-[#b68635]/70 text-[#ffe28a]">
                          {idx + 1}
                        </kbd>
                        <span className="font-cinzel font-extrabold text-[#f3c35c]">
                          {String.fromCharCode(65 + idx)}.
                        </span>
                      </span>
                      <span className="leading-snug">{opt}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function QuizFighterPage() {
  return (
    <Suspense
      fallback={
        <div className="arena-backdrop min-h-screen w-full flex items-center justify-center font-cinzel text-[#f7d279]">
          Loading…
        </div>
      }
    >
      <QuizFighterContent />
    </Suspense>
  );
}
