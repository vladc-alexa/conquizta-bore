"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { LanguageSwitcher, useI18n } from "@/lib/i18n";
import { InviteToast, LobbyRoom, LobbySeat, MatchLobby } from "@/components/MatchLobby";
import { stoneSound } from "@/lib/sound";

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

interface TowerState {
  id: number; // 0, 1, 2
  hp: number; // 2 -> 1 -> 0
  maxHp: number;
  x: number;
  baseY: number;
  width: number;
  height: number;
  collapseProgress: number; // 0 = intact, 0..1 = actively demolishing, 1 = ruins
  shake: number;
  hitFlash: number;
}

interface Boulder {
  fromSide: "left" | "right";
  targetSide: "left" | "right";
  targetTowerIdx: number;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  t: number; // 0..1
  speed: number;
  peakHeight: number;
}

interface DebrisBlock {
  x: number;
  y: number;
  vx: number;
  vy: number;
  w: number;
  h: number;
  rot: number;
  vrot: number;
  color: string;
  life: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  life: number;
  maxLife: number;
}

interface FloatingBanner {
  x: number;
  y: number;
  vy: number;
  text: string;
  color: string;
  life: number;
}

const STAGE_W = 960;
const STAGE_H = 440;
const GROUND_Y = 368;
const GRILA_SECONDS = 12;
const TIE_SECONDS = 10;

function createCastleTowers(side: "left" | "right"): TowerState[] {
  // 3 towers per castle: Rear Keep (tallest), Mid Bastion, Front Watchtower
  if (side === "left") {
    return [
      { id: 0, hp: 2, maxHp: 2, x: 76, baseY: GROUND_Y, width: 56, height: 158, collapseProgress: 0, shake: 0, hitFlash: 0 },
      { id: 1, hp: 2, maxHp: 2, x: 146, baseY: GROUND_Y, width: 52, height: 132, collapseProgress: 0, shake: 0, hitFlash: 0 },
      { id: 2, hp: 2, maxHp: 2, x: 212, baseY: GROUND_Y, width: 48, height: 112, collapseProgress: 0, shake: 0, hitFlash: 0 },
    ];
  }
  return [
    { id: 0, hp: 2, maxHp: 2, x: STAGE_W - 212, baseY: GROUND_Y, width: 48, height: 112, collapseProgress: 0, shake: 0, hitFlash: 0 },
    { id: 1, hp: 2, maxHp: 2, x: STAGE_W - 146, baseY: GROUND_Y, width: 52, height: 132, collapseProgress: 0, shake: 0, hitFlash: 0 },
    { id: 2, hp: 2, maxHp: 2, x: STAGE_W - 76, baseY: GROUND_Y, width: 56, height: 158, collapseProgress: 0, shake: 0, hitFlash: 0 },
  ];
}

function TowerSiegeContent() {
  const { lang, t } = useI18n();
  const searchParams = useSearchParams();
  const initialRoom = searchParams.get("room");

  const [screen, setScreen] = useState<"lobby" | "battle">("lobby");
  const [seats, setSeats] = useState<LobbySeat[]>([]);
  const [room, setRoom] = useState<LobbyRoom | null>(null);
  const [botDiff, setBotDiff] = useState<"easy" | "medium" | "hard">("medium");
  const [soundOn, setSoundOn] = useState(true);
  const [lobbyError, setLobbyError] = useState("");

  // Battle phases: loading -> grila -> tiebreaker -> animating -> matchOver
  const [phase, setPhase] = useState<"loading" | "grila" | "tiebreaker" | "animating" | "matchOver">("loading");
  const [roundNum, setRoundNum] = useState(1);
  const [grilaQ, setGrilaQ] = useState<GrilaQ | null>(null);
  const [tieQ, setTieQ] = useState<RapideQ | null>(null);
  const [timeLeft, setTimeLeft] = useState(GRILA_SECONDS);
  const [selectedOpt, setSelectedOpt] = useState<number | null>(null);
  const [tieInput, setTieInput] = useState("");
  const [targetTowerIdx, setTargetTowerIdx] = useState<number>(0); // enemy tower index 0..2
  const [eventBanner, setEventBanner] = useState<{
    headline: string;
    detail: string;
    tone: "good" | "bad" | "tie" | "neutral";
  } | null>(null);

  const [hud, setHud] = useState({
    leftAlive: 3,
    rightAlive: 3,
    winner: null as null | "left" | "right",
  });

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const assetsRef = useRef<{
    env?: HTMLImageElement;
    towerRedIntact?: HTMLImageElement;
    towerRedDamaged?: HTMLImageElement;
    towerBlueIntact?: HTMLImageElement;
    towerBlueDamaged?: HTMLImageElement;
    towerRuins?: HTMLImageElement;
    catapultChassis?: HTMLImageElement;
    catapultArm?: HTMLImageElement;
    castleWall?: HTMLImageElement;
  }>({});
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const qStartRef = useRef<number>(0);
  const answeredRef = useRef<boolean>(false);
  const tieInputRef = useRef<HTMLInputElement>(null);

  const simRef = useRef({
    running: false,
    leftTowers: createCastleTowers("left"),
    rightTowers: createCastleTowers("right"),
    leftCatapultArm: 0, // 0 = loaded, 1 = launched
    rightCatapultArm: 0,
    leftRecoil: 0,
    rightRecoil: 0,
    boulder: null as Boulder | null,
    debris: [] as DebrisBlock[],
    particles: [] as Particle[],
    banners: [] as FloatingBanner[],
    screenShake: 0,
    targetEnemyIdx: 0,
    postAnimFrames: 0,
    animDoneCallback: null as null | (() => void),
  });

  useEffect(() => {
    stoneSound.enabled = soundOn;
    if (!soundOn) stoneSound.stopAmbience();
    else if (screen === "battle") stoneSound.startAmbience();
  }, [soundOn, screen]);

  useEffect(() => {
    return () => stoneSound.stopAmbience();
  }, []);

  useEffect(() => {
    const manifest: Array<[keyof typeof assetsRef.current, string]> = [
      ["env", "/art/siege-env.jpg"],
      ["towerRedIntact", "/art/tower-intact-red.png"],
      ["towerRedDamaged", "/art/tower-damaged-red.png"],
      ["towerBlueIntact", "/art/tower-intact-blue.png"],
      ["towerBlueDamaged", "/art/tower-damaged-blue.png"],
      ["towerRuins", "/art/tower-ruins.png"],
      ["catapultChassis", "/art/catapult-chassis.png"],
      ["catapultArm", "/art/catapult-arm.png"],
      ["castleWall", "/art/castle-wall.png"],
    ];
    for (const [key, src] of manifest) {
      const img = new Image();
      img.src = src;
      img.onload = () => {
        assetsRef.current[key] = img;
      };
    }
  }, []);

  const clearTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  };

  useEffect(() => () => clearTimer(), []);

  const p1Name = seats[0]?.name || "Player 1";
  const p2Name = seats[1]?.name || "Sir Aldric (Bot)";

  const pickNextStandingTower = (towers: TowerState[], preferred: number): number => {
    if (towers[preferred] && towers[preferred].hp > 0) return preferred;
    const found = towers.findIndex((tw) => tw.hp > 0);
    return found >= 0 ? found : 0;
  };

  const loadGrilaRound = useCallback(
    async (nextRound: number) => {
      clearTimer();
      answeredRef.current = false;
      setSelectedOpt(null);
      setTieQ(null);
      setTieInput("");
      setEventBanner(null);
      setRoundNum(nextRound);
      setPhase("loading");

      const nextTarget = pickNextStandingTower(simRef.current.rightTowers, simRef.current.targetEnemyIdx);
      simRef.current.targetEnemyIdx = nextTarget;
      setTargetTowerIdx(nextTarget);

      try {
        const res = await fetch(`/api/questions?mode=grila&count=1&lang=${lang}`);
        const data = await res.json();
        const q: GrilaQ | undefined = data?.questions?.[0];
        if (!q) return;
        setGrilaQ(q);
        setTimeLeft(GRILA_SECONDS);
        qStartRef.current = Date.now();
        setPhase("grila");

        timerRef.current = setInterval(() => {
          const left = Math.max(0, GRILA_SECONDS - (Date.now() - qStartRef.current) / 1000);
          setTimeLeft(left);
          if (left <= 0) {
            clearTimer();
            if (!answeredRef.current) {
              resolveGrilaRef.current(q, -1);
            }
          }
        }, 80);
      } catch {
        /* ignore */
      }
    },
    [lang]
  );

  const launchCatapultAttack = useCallback(
    (attackerSide: "left" | "right", headline: string, detail: string, tone: "good" | "bad") => {
      const s = simRef.current;
      const targetSide = attackerSide === "left" ? "right" : "left";
      const targetTowers = targetSide === "right" ? s.rightTowers : s.leftTowers;
      const chosenIdx =
        attackerSide === "left"
          ? pickNextStandingTower(targetTowers, s.targetEnemyIdx)
          : pickNextStandingTower(targetTowers, Math.floor(Math.random() * 3));

      const targetTower = targetTowers[chosenIdx];
      setEventBanner({ headline, detail, tone });
      setPhase("animating");

      if (attackerSide === "left") {
        s.leftCatapultArm = 1;
        s.leftRecoil = 10;
      } else {
        s.rightCatapultArm = 1;
        s.rightRecoil = 10;
      }
      stoneSound.catapultLaunch(attackerSide);

      const startX = attackerSide === "left" ? 298 : STAGE_W - 298;
      const startY = GROUND_Y - 46;
      const endX = targetTower.x;
      const endY = targetTower.baseY - targetTower.height * 0.62;

      s.boulder = {
        fromSide: attackerSide,
        targetSide,
        targetTowerIdx: chosenIdx,
        startX,
        startY,
        endX,
        endY,
        t: 0,
        speed: 0.022,
        peakHeight: 165,
      };

      s.animDoneCallback = () => {
        const leftAlive = s.leftTowers.filter((tw) => tw.hp > 0).length;
        const rightAlive = s.rightTowers.filter((tw) => tw.hp > 0).length;
        setHud({
          leftAlive,
          rightAlive,
          winner: rightAlive === 0 ? "left" : leftAlive === 0 ? "right" : null,
        });
        if (rightAlive === 0 || leftAlive === 0) {
          setPhase("matchOver");
          stoneSound.victoryFanfare();
        } else {
          loadGrilaRound(roundNum + 1);
        }
      };
    },
    [loadGrilaRound, roundNum]
  );

  const startTiebreaker = useCallback(
    async (grilaCorrectText: string) => {
      clearTimer();
      answeredRef.current = false;
      setTieInput("");
      setEventBanner({
        headline: t("siegeTiebreakerPhase"),
        detail: `${t("fightAnswerWas")} ${grilaCorrectText}`,
        tone: "tie",
      });
      stoneSound.bell();

      try {
        const res = await fetch(`/api/questions?mode=rapide&count=1&lang=${lang}`);
        const data = await res.json();
        const q: RapideQ | undefined = data?.questions?.[0];
        if (!q) {
          launchCatapultAttack("left", t("siegeDirectHit"), grilaCorrectText, "good");
          return;
        }
        setTieQ(q);
        setTimeLeft(TIE_SECONDS);
        qStartRef.current = Date.now();
        setPhase("tiebreaker");
        setTimeout(() => tieInputRef.current?.focus(), 40);

        timerRef.current = setInterval(() => {
          const left = Math.max(0, TIE_SECONDS - (Date.now() - qStartRef.current) / 1000);
          setTimeLeft(left);
          if (left <= 0) {
            clearTimer();
            if (!answeredRef.current) {
              resolveTieRef.current(q, null, TIE_SECONDS * 1000);
            }
          }
        }, 80);
      } catch {
        launchCatapultAttack("left", t("siegeDirectHit"), grilaCorrectText, "good");
      }
    },
    [lang, launchCatapultAttack, t]
  );

  const resolveTiebreaker = useCallback(
    (q: RapideQ, playerGuess: number | null, elapsedMs: number) => {
      if (answeredRef.current) return;
      answeredRef.current = true;
      clearTimer();

      // Simulate opponent numeric estimate scaled by bot difficulty
      const spread = botDiff === "easy" ? 0.35 : botDiff === "medium" ? 0.16 : 0.06;
      const baseScale = Math.max(Math.abs(q.answer), 12);
      const offset = Math.round((Math.random() * 2 - 1) * baseScale * spread);
      const oppGuess = q.answer + offset;
      const oppTimeMs =
        botDiff === "easy"
          ? 5200 + Math.random() * 3500
          : botDiff === "medium"
          ? 3400 + Math.random() * 3200
          : 2200 + Math.random() * 2600;

      const playerDist = playerGuess === null ? Infinity : Math.abs(playerGuess - q.answer);
      const oppDist = Math.abs(oppGuess - q.answer);
      const playerWins = playerDist < oppDist || (playerDist === oppDist && elapsedMs <= oppTimeMs);

      const detail = `${t("fightAnswerWas")} ${q.answer} | ${t("siegeYourGuess")}: ${
        playerGuess === null ? "—" : playerGuess
      } (⏱ ${(elapsedMs / 1000).toFixed(2)}s) vs ${t("siegeOppGuess")}: ${oppGuess} (⏱ ${(oppTimeMs / 1000).toFixed(2)}s)`;

      if (playerWins) {
        launchCatapultAttack("left", t("siegeYouWonTie"), detail, "good");
      } else {
        launchCatapultAttack("right", t("siegeOppWonTie"), detail, "bad");
      }
    },
    [botDiff, launchCatapultAttack, t]
  );

  const resolveTieRef = useRef(resolveTiebreaker);
  resolveTieRef.current = resolveTiebreaker;

  const resolveGrila = useCallback(
    (q: GrilaQ, chosenIdx: number) => {
      if (answeredRef.current) return;
      answeredRef.current = true;
      clearTimer();
      setSelectedOpt(chosenIdx);

      const elapsedSec = chosenIdx === -1 ? GRILA_SECONDS : Math.max(0.05, (Date.now() - qStartRef.current) / 1000);
      const oppSec =
        botDiff === "easy" ? 4.8 + Math.random() * 4.2 : botDiff === "medium" ? 3.1 + Math.random() * 3.8 : 1.9 + Math.random() * 2.9;
      const timeTag = `⏱ ${lang === "ro" ? "Tu" : "You"}: ${elapsedSec.toFixed(2)}s · ${p2Name}: ${oppSec.toFixed(2)}s`;

      const playerCorrect = chosenIdx === q.correctIndex;
      const oppAcc = botDiff === "easy" ? 0.45 : botDiff === "medium" ? 0.64 : 0.8;
      const oppCorrect = Math.random() < oppAcc;
      const correctText = q.options[q.correctIndex] ?? "";

      if (playerCorrect && oppCorrect) {
        // TIED! Decided on a Fast Numeric Question!
        startTiebreaker(`${correctText} (${timeTag})`);
      } else if (playerCorrect && !oppCorrect) {
        launchCatapultAttack(
          "left",
          t("siegeFiring"),
          `${t("fightAnswerWas")} ${correctText}  •  ${timeTag}`,
          "good"
        );
      } else if (!playerCorrect && oppCorrect) {
        launchCatapultAttack(
          "right",
          `${p2Name} — ${t("siegeFiring")}`,
          `${t("fightAnswerWas")} ${correctText}  •  ${timeTag}`,
          "bad"
        );
      } else {
        // Both wrong: no catapult fires, brief pause then next round
        setEventBanner({
          headline: t("siegeBothWrong"),
          detail: `${t("fightAnswerWas")} ${correctText}  •  ${timeTag}`,
          tone: "neutral",
        });
        setPhase("animating");
        stoneSound.block();
        setTimeout(() => loadGrilaRound(roundNum + 1), 1700);
      }
    },
    [botDiff, launchCatapultAttack, loadGrilaRound, p2Name, roundNum, startTiebreaker, t]
  );

  const resolveGrilaRef = useRef(resolveGrila);
  resolveGrilaRef.current = resolveGrila;

  const startSiege = async () => {
    setLobbyError("");
    // Auto-fill 2nd seat with a bot if still open so user can jump straight in!
    let activeSeats = seats;
    if (activeSeats.length < 2 && room) {
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

    const s = simRef.current;
    s.running = true;
    s.leftTowers = createCastleTowers("left");
    s.rightTowers = createCastleTowers("right");
    s.leftCatapultArm = 0;
    s.rightCatapultArm = 0;
    s.boulder = null;
    s.debris = [];
    s.particles = [];
    s.banners = [];
    s.screenShake = 0;
    s.targetEnemyIdx = 0;
    s.postAnimFrames = 0;
    s.animDoneCallback = null;
    setHud({ leftAlive: 3, rightAlive: 3, winner: null });
    setScreen("battle");
    stoneSound.warHorn();
    loadGrilaRound(1);
  };

  // Keyboard shortcuts 1-4 / Numpad1-4 / A-D during Grilă
  useEffect(() => {
    if (screen !== "battle" || phase !== "grila" || !grilaQ) return;
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
      if (idx !== undefined && idx < grilaQ.options.length) {
        e.preventDefault();
        resolveGrila(grilaQ, idx);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [screen, phase, grilaQ, resolveGrila]);

  // Canvas click to select which enemy standing tower to target!
  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const cx = ((e.clientX - rect.left) / rect.width) * STAGE_W;
    const cy = ((e.clientY - rect.top) / rect.height) * STAGE_H;
    const towers = simRef.current.rightTowers;
    for (let i = 0; i < towers.length; i++) {
      const tw = towers[i];
      if (
        tw.hp > 0 &&
        cx >= tw.x - tw.width * 0.7 &&
        cx <= tw.x + tw.width * 0.7 &&
        cy >= tw.baseY - tw.height - 25 &&
        cy <= tw.baseY
      ) {
        simRef.current.targetEnemyIdx = i;
        setTargetTowerIdx(i);
        stoneSound.tick();
        break;
      }
    }
  };

  // 60FPS Siege Battlefield Canvas Renderer (Catapults, Parabolic Flaming Boulders, Direct Hits & Tower Demolition!)
  useEffect(() => {
    if (screen !== "battle") return;
    let rafId = 0;
    let frame = 0;

    const spawnExplosion = (x: number, y: number, isDemolition: boolean) => {
      const s = simRef.current;
      const fireColors = ["#ffffff", "#fef08a", "#fb923c", "#ef4444", "#7c2d12"];
      const count = isDemolition ? 56 : 28;
      for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2;
        const spd = 1.5 + Math.random() * (isDemolition ? 10 : 6.5);
        s.particles.push({
          x,
          y,
          vx: Math.cos(a) * spd,
          vy: Math.sin(a) * spd - (isDemolition ? 3.5 : 2),
          size: (isDemolition ? 4 : 3) + Math.random() * 6,
          color: fireColors[Math.floor(Math.random() * fireColors.length)],
          life: 26 + Math.floor(Math.random() * 24),
          maxLife: 50,
        });
      }
      // Stone masonry debris chunks
      const blockCount = isDemolition ? 28 : 10;
      const stoneShades = ["#78716c", "#57534e", "#a8a29e", "#44403c", "#d6d3d1"];
      for (let i = 0; i < blockCount; i++) {
        s.debris.push({
          x: x + (Math.random() - 0.5) * 44,
          y: y + (Math.random() - 0.5) * (isDemolition ? 80 : 30),
          vx: (Math.random() - 0.5) * (isDemolition ? 11 : 7),
          vy: -3 - Math.random() * (isDemolition ? 9.5 : 5.5),
          w: 7 + Math.random() * 11,
          h: 6 + Math.random() * 9,
          rot: Math.random() * Math.PI,
          vrot: (Math.random() - 0.5) * 0.25,
          color: stoneShades[Math.floor(Math.random() * stoneShades.length)],
          life: 75 + Math.floor(Math.random() * 35),
        });
      }
    };

    const drawCatapult = (
      ctx: CanvasRenderingContext2D,
      x: number,
      y: number,
      facing: 1 | -1,
      armState: number,
      recoil: number
    ) => {
      const a = assetsRef.current;
      ctx.save();
      ctx.translate(x - facing * recoil, y);
      ctx.scale(facing, 1);

      // Ground contact shadow
      ctx.fillStyle = "rgba(8, 6, 4, 0.58)";
      ctx.beginPath();
      ctx.ellipse(0, 2, 42, 8, 0, 0, Math.PI * 2);
      ctx.fill();

      // Pivoting photorealistic oak throwing arm (behind front chassis beam)
      ctx.save();
      ctx.translate(6, -24);
      const angle = -0.35 + armState * 1.48;
      ctx.rotate(angle);
      if (a.catapultArm) {
        ctx.drawImage(a.catapultArm, -66, -14, 76, 28);
      } else {
        ctx.fillStyle = "#7c4a20";
        ctx.fillRect(-52, -4, 58, 8);
      }
      // Flaming boulder resting in the leather sling when cocked
      if (armState < 0.22) {
        const g = ctx.createRadialGradient(-56, -4, 2, -56, -4, 15);
        g.addColorStop(0, "#ffffff");
        g.addColorStop(0.4, "#fde047");
        g.addColorStop(0.75, "#f97316");
        g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(-56, -4, 15, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#292524";
        ctx.beginPath();
        ctx.arc(-56, -4, 6, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      // Photorealistic oak & forged-iron catapult chassis sprite
      if (a.catapultChassis) {
        ctx.drawImage(a.catapultChassis, -48, -64, 96, 66);
      }

      ctx.restore();
    };

    const drawTower = (
      ctx: CanvasRenderingContext2D,
      tw: TowerState,
      side: "left" | "right",
      isTargeted: boolean
    ) => {
      const a = assetsRef.current;
      ctx.save();
      const sx = tw.shake > 0 ? (Math.random() - 0.5) * tw.shake : 0;
      ctx.translate(tw.x + sx, tw.baseY);

      const collapseFrac = tw.hp === 0 ? tw.collapseProgress : 0;
      // Scale height proportionally (rear tower tallest, front watchtower compact)
      const drawW = tw.width * 1.56;
      const drawH = tw.height * 1.48;

      // Ground contact shadow
      ctx.fillStyle = "rgba(6, 5, 8, 0.52)";
      ctx.beginPath();
      ctx.ellipse(0, 3, drawW * 0.44, 9, 0, 0, Math.PI * 2);
      ctx.fill();

      if (tw.hp === 0 && collapseFrac >= 0.92) {
        // Photorealistic smoldering stone ruins sprite
        if (a.towerRuins) {
          ctx.drawImage(a.towerRuins, -drawW * 0.54, -48, drawW * 1.08, 54);
        }
      } else {
        const sprite =
          side === "left"
            ? tw.hp === 2
              ? a.towerRedIntact
              : a.towerRedDamaged
            : tw.hp === 2
            ? a.towerBlueIntact
            : a.towerBlueDamaged;

        if (sprite) {
          ctx.save();
          // During demolition collapse, clip cleanly at ground & sink + tilt the fracturing stone tower downward!
          ctx.beginPath();
          ctx.rect(-drawW, -drawH - 60, drawW * 2, drawH + 62);
          ctx.clip();
          const sinkY = collapseFrac * (drawH * 0.88);
          const tilt = collapseFrac * (side === "left" ? -0.18 : 0.18);
          ctx.translate(0, sinkY);
          ctx.rotate(tilt);
          ctx.drawImage(sprite, -drawW / 2, -drawH, drawW, drawH);

          // White impact flash overlay on direct boulder hit
          if (tw.hitFlash > 0) {
            ctx.globalCompositeOperation = "lighter";
            ctx.globalAlpha = Math.min(0.65, tw.hitFlash / 16);
            ctx.drawImage(sprite, -drawW / 2, -drawH, drawW, drawH);
            ctx.globalAlpha = 1;
            ctx.globalCompositeOperation = "source-over";
          }
          ctx.restore();

          // Live flickering volumetric firelight inside breach when damaged (1/2 HP)
          if (tw.hp === 1) {
            const flicker = 0.65 + Math.sin(frame * 0.35 + tw.id * 2) * 0.25;
            const fx = side === "left" ? drawW * 0.12 : -drawW * 0.12;
            const fy = -drawH * 0.54;
            const fg = ctx.createRadialGradient(fx, fy, 2, fx, fy, 26 * flicker);
            fg.addColorStop(0, "rgba(255, 240, 140, 0.85)");
            fg.addColorStop(0.45, "rgba(249, 115, 22, 0.55)");
            fg.addColorStop(1, "rgba(0,0,0,0)");
            ctx.fillStyle = fg;
            ctx.beginPath();
            ctx.arc(fx, fy, 26 * flicker, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }

      // Per-Tower Life Bar above every tower! (2 blows downs each tower)
      const barW = 48;
      const barH = 10;
      const barY = tw.hp === 0 ? -56 : -drawH - 12;
      ctx.fillStyle = "rgba(10, 8, 16, 0.9)";
      ctx.strokeStyle = isTargeted ? "#fde047" : "#d4a147";
      ctx.lineWidth = isTargeted ? 2.2 : 1.4;
      ctx.beginPath();
      ctx.roundRect(-barW / 2, barY, barW, barH, 3);
      ctx.fill();
      ctx.stroke();

      for (let pip = 0; pip < 2; pip++) {
        if (pip < tw.hp) {
          ctx.fillStyle = tw.hp === 2 ? "#22c55e" : "#f97316";
          ctx.fillRect(-barW / 2 + 2 + pip * 23, barY + 2, 21, barH - 4);
        }
      }

      // Golden target crosshair reticle on selected enemy tower
      if (isTargeted && tw.hp > 0) {
        const pulse = Math.sin(frame * 0.16) * 4;
        const ty = -drawH * 0.52;
        ctx.strokeStyle = "#fde047";
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.arc(0, ty, 22 + pulse, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(-30, ty);
        ctx.lineTo(30, ty);
        ctx.moveTo(0, ty - 30);
        ctx.lineTo(0, ty + 30);
        ctx.stroke();
      }

      ctx.restore();
    };

    const tick = () => {
      const s = simRef.current;
      if (!s.running) return;
      frame++;

      if (s.screenShake > 0) s.screenShake *= 0.86;
      if (s.screenShake < 0.25) s.screenShake = 0;

      // Smoothly return catapult arms & recoil back to loaded pose
      if (!s.boulder) {
        s.leftCatapultArm *= 0.92;
        s.rightCatapultArm *= 0.92;
      }
      s.leftRecoil *= 0.86;
      s.rightRecoil *= 0.86;

      // Update tower shakes, flashes, demolition collapses, and damaged-tower fire/smoke particles
      for (const tw of [...s.leftTowers, ...s.rightTowers]) {
        if (tw.shake > 0) tw.shake *= 0.85;
        if (tw.hitFlash > 0) tw.hitFlash--;
        if (tw.hp === 0 && tw.collapseProgress < 1) {
          tw.collapseProgress = Math.min(1, tw.collapseProgress + 0.025);
          if (frame % 3 === 0) {
            s.particles.push({
              x: tw.x + (Math.random() - 0.5) * tw.width,
              y: tw.baseY - tw.height * (1 - tw.collapseProgress) - 10,
              vx: (Math.random() - 0.5) * 2.5,
              vy: -1.5 - Math.random() * 2,
              size: 7 + Math.random() * 8,
              color: Math.random() < 0.4 ? "#fb923c" : "#57534e",
              life: 32,
              maxLife: 32,
            });
          }
        }
        // Damaged tower smoke & embers
        if (tw.hp === 1 && frame % 6 === 0) {
          s.particles.push({
            x: tw.x + (Math.random() - 0.5) * 24,
            y: tw.baseY - tw.height * 0.72,
            vx: (Math.random() - 0.5) * 0.8,
            vy: -1.4 - Math.random() * 1.2,
            size: 4 + Math.random() * 5,
            color: Math.random() < 0.35 ? "#f97316" : "rgba(68,64,60,0.75)",
            life: 28,
            maxLife: 28,
          });
        }
      }

      // Animate flying flaming boulder
      if (s.boulder) {
        const b = s.boulder;
        b.t += b.speed;
        const bx = b.startX + (b.endX - b.startX) * b.t;
        const by = b.startY + (b.endY - b.startY) * b.t - Math.sin(b.t * Math.PI) * b.peakHeight;

        // Fire trail
        for (let k = 0; k < 2; k++) {
          s.particles.push({
            x: bx + (Math.random() - 0.5) * 8,
            y: by + (Math.random() - 0.5) * 8,
            vx: (Math.random() - 0.5) * 1.2,
            vy: (Math.random() - 0.5) * 1.2 - 0.5,
            size: 4 + Math.random() * 5,
            color: k === 0 ? "#fde047" : "#f97316",
            life: 20,
            maxLife: 20,
          });
        }

        if (b.t >= 1) {
          // DIRECT HIT!
          const targetTowers = b.targetSide === "right" ? s.rightTowers : s.leftTowers;
          const tw = targetTowers[b.targetTowerIdx];
          tw.hp = Math.max(0, tw.hp - 1);
          tw.hitFlash = 14;
          const demolished = tw.hp === 0;
          tw.shake = demolished ? 20 : 12;
          s.screenShake = demolished ? 20 : 11;

          spawnExplosion(tw.x, tw.baseY - tw.height * 0.58, demolished);
          if (demolished) {
            stoneSound.towerDemolish(b.targetSide);
            s.banners.push({
              x: tw.x,
              y: tw.baseY - tw.height - 20,
              vy: -1.1,
              text: "💥 DEMOLISHED!",
              color: "#fde047",
              life: 72,
            });
            setEventBanner((prev) =>
              prev ? { ...prev, headline: t("siegeTowerDown") } : null
            );
          } else {
            stoneSound.towerHit(b.targetSide);
            s.banners.push({
              x: tw.x,
              y: tw.baseY - tw.height - 20,
              vy: -1.1,
              text: "DIRECT HIT! 1/2 HP",
              color: "#fb923c",
              life: 62,
            });
            setEventBanner((prev) =>
              prev ? { ...prev, headline: t("siegeDirectHit") } : null
            );
          }

          s.boulder = null;
          s.postAnimFrames = demolished ? 86 : 58;
        }
      } else if (s.postAnimFrames > 0) {
        s.postAnimFrames--;
        if (s.postAnimFrames === 0 && s.animDoneCallback) {
          const cb = s.animDoneCallback;
          s.animDoneCallback = null;
          cb();
        }
      }

      // Physics for falling stone debris & particles
      for (let i = s.debris.length - 1; i >= 0; i--) {
        const d = s.debris[i];
        d.vy += 0.42;
        d.x += d.vx;
        d.y += d.vy;
        d.rot += d.vrot;
        if (d.y > GROUND_Y) {
          d.y = GROUND_Y;
          d.vy *= -0.35;
          d.vx *= 0.7;
        }
        d.life--;
        if (d.life <= 0) s.debris.splice(i, 1);
      }

      for (let i = s.particles.length - 1; i >= 0; i--) {
        const pt = s.particles[i];
        pt.x += pt.vx;
        pt.y += pt.vy;
        pt.life--;
        if (pt.life <= 0) s.particles.splice(i, 1);
      }

      for (let i = s.banners.length - 1; i >= 0; i--) {
        const bn = s.banners[i];
        bn.y += bn.vy;
        bn.life--;
        if (bn.life <= 0) s.banners.splice(i, 1);
      }

      // ---- Render Battlefield ----
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.save();
          if (s.screenShake > 0) {
            ctx.translate((Math.random() - 0.5) * s.screenShake, (Math.random() - 0.5) * s.screenShake);
          }

          // Photorealistic golden sunset alpine valley + rocky cliff plateaus
          const a = assetsRef.current;
          if (a.env) {
            ctx.drawImage(a.env, 0, 0, STAGE_W, STAGE_H);
          } else {
            ctx.fillStyle = "#1c1320";
            ctx.fillRect(0, 0, STAGE_W, STAGE_H);
          }

          // Live drifting golden valley mist & soaring distant birds for living environment!
          const mistShift = (frame * 0.35) % STAGE_W;
          const mistGrad = ctx.createRadialGradient(
            STAGE_W * 0.5 + Math.sin(frame * 0.008) * 60,
            GROUND_Y - 10,
            20,
            STAGE_W * 0.5,
            GROUND_Y,
            260
          );
          mistGrad.addColorStop(0, "rgba(255, 224, 165, 0.24)");
          mistGrad.addColorStop(1, "rgba(255, 224, 165, 0)");
          ctx.fillStyle = mistGrad;
          ctx.fillRect(0, GROUND_Y - 120, STAGE_W, 180);

          // Distant soaring eagles/ravens silhouette across sunset sky
          ctx.strokeStyle = "rgba(38, 24, 18, 0.65)";
          ctx.lineWidth = 1.6;
          for (let bIdx = 0; bIdx < 3; bIdx++) {
            const bx = ((mistShift * (0.9 + bIdx * 0.2) + bIdx * 240) % (STAGE_W + 60)) - 30;
            const by = 86 + bIdx * 24 + Math.sin(frame * 0.04 + bIdx * 2) * 8;
            const flap = Math.sin(frame * 0.16 + bIdx * 1.7) * 4;
            ctx.beginPath();
            ctx.moveTo(bx - 7, by + flap);
            ctx.quadraticCurveTo(bx - 3, by - 3, bx, by);
            ctx.quadraticCurveTo(bx + 3, by - 3, bx + 7, by + flap);
            ctx.stroke();
          }

          // Photorealistic stone curtain walls connecting each castle's 3 towers
          if (a.castleWall) {
            ctx.drawImage(a.castleWall, 42, GROUND_Y - 68, 200, 72);
            ctx.drawImage(a.castleWall, STAGE_W - 242, GROUND_Y - 68, 200, 72);
          }

          // Draw all 6 photorealistic 3D-lit Towers with per-tower life bars
          s.leftTowers.forEach((tw) => drawTower(ctx, tw, "left", false));
          s.rightTowers.forEach((tw, i) => drawTower(ctx, tw, "right", i === s.targetEnemyIdx));

          // Draw Left & Right photorealistic Wooden Siege Catapults
          drawCatapult(ctx, 294, GROUND_Y + 4, 1, s.leftCatapultArm, s.leftRecoil);
          drawCatapult(ctx, STAGE_W - 294, GROUND_Y + 4, -1, s.rightCatapultArm, s.rightRecoil);

          // Draw flying flaming boulder
          if (s.boulder) {
            const b = s.boulder;
            const bx = b.startX + (b.endX - b.startX) * b.t;
            const by = b.startY + (b.endY - b.startY) * b.t - Math.sin(b.t * Math.PI) * b.peakHeight;
            const glow = ctx.createRadialGradient(bx, by, 4, bx, by, 28);
            glow.addColorStop(0, "#ffffff");
            glow.addColorStop(0.4, "#fde047");
            glow.addColorStop(0.75, "#f97316");
            glow.addColorStop(1, "rgba(0,0,0,0)");
            ctx.fillStyle = glow;
            ctx.beginPath();
            ctx.arc(bx, by, 28, 0, Math.PI * 2);
            ctx.fill();

            ctx.fillStyle = "#292524";
            ctx.beginPath();
            ctx.arc(bx, by, 10, 0, Math.PI * 2);
            ctx.fill();
          }

          // Falling masonry debris
          for (const d of s.debris) {
            ctx.save();
            ctx.translate(d.x, d.y);
            ctx.rotate(d.rot);
            ctx.fillStyle = d.color;
            ctx.strokeStyle = "#1c1917";
            ctx.lineWidth = 1;
            ctx.fillRect(-d.w / 2, -d.h / 2, d.w, d.h);
            ctx.strokeRect(-d.w / 2, -d.h / 2, d.w, d.h);
            ctx.restore();
          }

          // Fire & smoke particles
          for (const pt of s.particles) {
            ctx.globalAlpha = Math.max(0, pt.life / pt.maxLife);
            ctx.fillStyle = pt.color;
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, pt.size, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.globalAlpha = 1;

          // Floating impact callouts
          for (const bn of s.banners) {
            ctx.save();
            ctx.globalAlpha = Math.min(1, bn.life / 18);
            ctx.font = "800 18px Cinzel, Georgia, serif";
            ctx.textAlign = "center";
            ctx.lineWidth = 4;
            ctx.strokeStyle = "#09060c";
            ctx.strokeText(bn.text, bn.x, bn.y);
            ctx.fillStyle = bn.color;
            ctx.fillText(bn.text, bn.x, bn.y);
            ctx.restore();
          }

          ctx.restore();
        }
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [screen, t]);

  return (
    <div className="arena-backdrop min-h-screen w-full px-3 sm:px-6 py-4 flex flex-col items-center">
      <InviteToast />

      {/* Top Header */}
      <header className="w-full max-w-[1100px] flex flex-wrap items-center justify-between gap-3 mb-4">
        <Link
          href="/"
          className="royal-panel hover:border-[#f5cd71] rounded-xl px-4 py-2 text-xs font-cinzel font-bold tracking-wider text-[#f7e1b0] hover:text-white transition-all"
        >
          ← {t("fightBackLobby")}
        </Link>

        <div className="text-center royal-panel rounded-2xl px-6 py-2">
          <h1 className="font-cinzel font-extrabold text-xl sm:text-2xl tracking-[0.14em] gold-title leading-none">
            🏰 {t("siegeTitle")}
          </h1>
          <p className="text-[0.7rem] text-[#e8d3aa] hidden sm:block mt-0.5">{t("siegeSubtitle")}</p>
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

      {/* ==================== LOBBY SCREEN ==================== */}
      {screen === "lobby" && (
        <div className="w-full max-w-[1000px] flex flex-col gap-5">
          {/* Illustrated Siege Hero Banner */}
          <div className="royal-panel rounded-2xl overflow-hidden grid sm:grid-cols-[220px_1fr]">
            <img
              src="/art/card-siege.jpg"
              alt={t("siegeTitle")}
              className="w-full h-56 sm:h-full object-cover"
            />
            <div className="p-5 sm:p-6 flex flex-col justify-center gap-3">
              <h2 className="font-cinzel font-extrabold text-2xl gold-title">{t("siegeTitle")}</h2>
              <p className="text-xs sm:text-sm text-[#e8d5b0] leading-relaxed">{t("siegeHowItWorks")}</p>
              <div className="flex flex-wrap gap-2 text-[0.7rem] font-cinzel text-[#ffe28a]">
                <span className="bg-[#181224] border border-[#b68635]/60 rounded-full px-3 py-1">
                  🏰 3 {t("siegeTowersLeft")} × 2 HP
                </span>
                <span className="bg-[#181224] border border-[#b68635]/60 rounded-full px-3 py-1">
                  🎯 Grilă
                </span>
                <span className="bg-[#181224] border border-[#b68635]/60 rounded-full px-3 py-1">
                  ⚡ Fast Tiebreaker
                </span>
              </div>
            </div>
          </div>

          {/* Online Invite & Bot Fill Lobby */}
          <MatchLobby
            gameType="siege"
            maxSeats={2}
            botDifficulty={botDiff}
            onDifficultyChange={setBotDiff}
            initialRoomCode={initialRoom}
            onSeatsChange={(s, r) => {
              setSeats(s);
              setRoom(r);
            }}
          />

          {lobbyError && (
            <div className="text-center text-xs text-rose-300 bg-rose-950/70 border border-rose-400/50 rounded-xl p-2.5">
              {lobbyError}
            </div>
          )}

          <div className="flex justify-center">
            <button
              type="button"
              onClick={startSiege}
              className="btn-crimson rounded-2xl px-14 py-4 font-cinzel font-extrabold text-lg sm:text-xl tracking-[0.2em] uppercase cursor-pointer animate-gold-glow"
            >
              🔥 {t("siegeStart")} 🔥
            </button>
          </div>
        </div>
      )}

      {/* ==================== LIVE TOWER SIEGE BATTLE ==================== */}
      {screen === "battle" && (
        <div className="w-full max-w-[980px] flex flex-col gap-3.5">
          {/* Battlefield Canvas + Top Castle HUD */}
          <div className="relative rounded-2xl overflow-hidden border-[3px] border-[#d4a147] shadow-[0_18px_50px_rgba(0,0,0,0.85)] bg-black">
            {/* Top Score Strip */}
            <div className="absolute top-0 inset-x-0 z-20 px-4 py-2.5 flex items-center justify-between gap-2 pointer-events-none">
              <div className="royal-panel rounded-xl px-3.5 py-1.5 flex items-center gap-2.5">
                <span className="font-cinzel font-bold text-xs sm:text-sm text-[#ffefc8]">{p1Name}</span>
                <span className="text-xs font-cinzel font-extrabold text-emerald-400">
                  🏰 {hud.leftAlive}/3
                </span>
              </div>

              <div className="royal-panel rounded-xl px-4 py-1 text-center">
                <div className="text-[0.58rem] font-cinzel text-[#d8bc88] uppercase">
                  {t("fightRound")} {roundNum}
                </div>
                <div
                  className={`font-cinzel font-extrabold text-lg leading-none ${
                    (phase === "grila" || phase === "tiebreaker") && timeLeft <= 3
                      ? "text-red-400 animate-pulse"
                      : "gold-title"
                  }`}
                >
                  {phase === "grila" || phase === "tiebreaker" ? Math.ceil(timeLeft) : "🔥"}
                </div>
              </div>

              <div className="royal-panel rounded-xl px-3.5 py-1.5 flex items-center gap-2.5">
                <span className="text-xs font-cinzel font-extrabold text-sky-300">
                  🏰 {hud.rightAlive}/3
                </span>
                <span className="font-cinzel font-bold text-xs sm:text-sm text-[#ffefc8]">{p2Name}</span>
              </div>
            </div>

            {/* Event Banner Overlay during Catapult Fire / Tiebreaker */}
            {eventBanner && phase !== "matchOver" && (
              <div className="absolute top-16 inset-x-0 z-20 flex flex-col items-center pointer-events-none px-4 text-center">
                <div
                  className={`px-5 py-1.5 rounded-xl border-2 font-cinzel font-extrabold text-xs sm:text-sm tracking-wider shadow-2xl ${
                    eventBanner.tone === "tie"
                      ? "bg-amber-950/95 border-yellow-400 text-yellow-200 animate-pulse"
                      : eventBanner.tone === "good"
                      ? "bg-emerald-950/90 border-emerald-400 text-emerald-200"
                      : eventBanner.tone === "bad"
                      ? "bg-rose-950/90 border-rose-400 text-rose-200"
                      : "bg-slate-900/90 border-slate-400 text-slate-200"
                  }`}
                >
                  {eventBanner.headline}
                </div>
              </div>
            )}

            {/* Victory Overlay */}
            {phase === "matchOver" && hud.winner && (
              <div className="absolute inset-0 z-30 bg-black/65 flex flex-col items-center justify-center px-4 text-center">
                <div className="text-5xl mb-2">{hud.winner === "left" ? "🏆" : "💥"}</div>
                <div className="font-cinzel font-extrabold text-4xl sm:text-5xl gold-title">
                  {hud.winner === "left" ? t("siegeVictory") : t("siegeDefeat")}
                </div>
                <div className="crimson-ribbon mt-2 px-8 py-1.5 font-cinzel font-bold text-sm sm:text-base text-[#fff6dc]">
                  {hud.winner === "left" ? p1Name : p2Name} — {t("siegeCastleFallen")}
                </div>
                <div className="flex gap-3 mt-6">
                  <button
                    type="button"
                    onClick={startSiege}
                    className="btn-crimson rounded-xl px-6 py-3 font-cinzel font-bold text-xs sm:text-sm uppercase cursor-pointer"
                  >
                    🔥 {t("fightRematch")}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      clearTimer();
                      simRef.current.running = false;
                      setScreen("lobby");
                    }}
                    className="btn-sapphire rounded-xl px-6 py-3 font-cinzel font-bold text-xs sm:text-sm uppercase cursor-pointer"
                  >
                    {t("lobbyTitle").split("—")[0]}
                  </button>
                </div>
              </div>
            )}

            {/* Target Hint Footer Strip on Canvas */}
            <div className="absolute bottom-2 inset-x-0 z-20 text-center pointer-events-none">
              <span className="bg-black/65 border border-[#b68635]/50 rounded-full px-3 py-0.5 text-[0.68rem] text-[#f5dfb4]">
                🎯 {t("siegeTargetHint")} (#{targetTowerIdx + 1})
              </span>
            </div>

            <canvas
              ref={canvasRef}
              width={STAGE_W}
              height={STAGE_H}
              onClick={handleCanvasClick}
              className="w-full h-auto block cursor-crosshair select-none"
            />
          </div>

          {/* ==================== QUESTION / TIEBREAKER CONSOLE ==================== */}
          <div className="royal-panel rounded-2xl p-4 sm:p-5 flex flex-col gap-3">
            {phase === "loading" && (
              <div className="py-5 text-center font-cinzel text-[#f7d279] text-sm">
                ⏳ {t("trainLoading")}
              </div>
            )}

            {phase === "animating" && (
              <div className="py-4 text-center flex flex-col gap-1">
                <div className="font-cinzel font-extrabold text-base gold-title">
                  {eventBanner?.headline}
                </div>
                <div className="text-xs text-[#dfd0ad]">{eventBanner?.detail}</div>
              </div>
            )}

            {phase === "grila" && grilaQ && (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="font-cinzel font-bold text-[#ffd977] uppercase tracking-wider">
                    🎯 {t("siegeGrilaPhase")}
                    {grilaQ.category ? ` • ${grilaQ.category}` : ""}
                  </span>
                  <span className="text-[#d6be92] text-[0.72rem]">{Math.ceil(timeLeft)}s</span>
                </div>
                <div className="h-2 bg-[#0d0a12] rounded-full overflow-hidden border border-[#8e672b]/60">
                  <div
                    className={`h-full transition-all duration-100 ${
                      timeLeft <= 3
                        ? "bg-gradient-to-r from-red-600 to-rose-400"
                        : "bg-gradient-to-r from-[#c97e2a] via-[#f2c45e] to-[#fff0b3]"
                    }`}
                    style={{ width: `${(timeLeft / GRILA_SECONDS) * 100}%` }}
                  />
                </div>
                <div className="parchment-panel rounded-xl px-4 py-3.5">
                  <p className="font-cinzel font-bold text-sm sm:text-base text-[#241306] leading-snug">
                    {grilaQ.prompt}
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {grilaQ.options.map((opt, idx) => (
                    <button
                      key={idx}
                      type="button"
                      disabled={selectedOpt !== null}
                      onClick={() => resolveGrila(grilaQ, idx)}
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

            {/* FAST NUMERIC TIEBREAKER (Only triggered when Grilă is tied!) */}
            {phase === "tiebreaker" && tieQ && (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="font-cinzel font-extrabold text-[#fde047] uppercase tracking-wider animate-pulse">
                    {t("siegeTiebreakerPhase")}
                  </span>
                  <span className="text-[#fde047] font-bold">{Math.ceil(timeLeft)}s</span>
                </div>
                <p className="text-xs text-[#e8d5b0]">{t("siegeTiebreakerDesc")}</p>
                <div className="h-2 bg-[#0d0a12] rounded-full overflow-hidden border border-yellow-400/70">
                  <div
                    className="h-full bg-gradient-to-r from-amber-500 via-yellow-300 to-white transition-all duration-100"
                    style={{ width: `${(timeLeft / TIE_SECONDS) * 100}%` }}
                  />
                </div>
                <div className="parchment-panel rounded-xl px-4 py-3.5 border-2 border-yellow-400">
                  <p className="font-cinzel font-bold text-sm sm:text-base text-[#241306]">
                    {tieQ.prompt}
                  </p>
                </div>
                <div className="flex gap-2.5">
                  <input
                    ref={tieInputRef}
                    type="text"
                    inputMode="numeric"
                    value={tieInput}
                    onChange={(e) => {
                      const v = e.target.value.replace(/[^0-9-]/g, "");
                      if (/^-?\d*$/.test(v)) setTieInput(v);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && tieInput !== "" && !answeredRef.current) {
                        resolveTiebreaker(
                          tieQ,
                          parseInt(tieInput, 10),
                          Date.now() - qStartRef.current
                        );
                      }
                    }}
                    placeholder={t("trainNumericPlaceholder")}
                    className="flex-1 bg-[#0b0910] border-2 border-yellow-400 rounded-xl text-[#ffe59e] text-2xl font-cinzel font-bold text-center py-2.5 outline-none"
                  />
                  <button
                    type="button"
                    disabled={tieInput === ""}
                    onClick={() =>
                      resolveTiebreaker(
                        tieQ,
                        parseInt(tieInput, 10),
                        Date.now() - qStartRef.current
                      )
                    }
                    className="btn-crimson rounded-xl px-7 font-cinzel font-extrabold text-sm uppercase cursor-pointer disabled:opacity-40"
                  >
                    🔥 OK
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function TowerSiegePage() {
  return (
    <Suspense
      fallback={
        <div className="arena-backdrop min-h-screen w-full flex items-center justify-center font-cinzel text-[#f7d279]">
          Loading…
        </div>
      }
    >
      <TowerSiegeContent />
    </Suspense>
  );
}
