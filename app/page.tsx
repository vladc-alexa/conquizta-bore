"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import { LanguageSwitcher, useI18n } from "@/lib/i18n";
import { ThemeSwitcher, useArtTheme } from "@/lib/theme";
import { InviteToast } from "@/components/MatchLobby";
import GeneralChat from "@/components/GeneralChat";

interface ChatMessage {
  id: string;
  authorName: string;
  text: string;
  createdAt: string;
}

interface DailyLeaderRow {
  id?: string;
  name: string;
  wins?: number;
  correct: number;
  wrong: number;
  accuracy?: number;
}

interface OnlinePlayer {
  id: string;
  name: string;
  color?: string | null;
  online?: boolean;
  where?: string | null;
}

// Preserved localStorage key so existing players keep their PRC records
const PRC_BEST_KEY = "conquizta_bore_prc_best";
const PRC_SECONDS = 30;

export default function Dashboard() {
  const { lang, t } = useI18n();
  const { art } = useArtTheme();
  const [name, setName] = useState<string | null>(null);
  const [myPrc, setMyPrc] = useState<number | null>(null);
  const [myWins, setMyWins] = useState<number>(0);
  const [isAdmin, setIsAdmin] = useState(false);
  const [siteOff, setSiteOff] = useState(false);
  const [rows, setRows] = useState<DailyLeaderRow[]>([]);
  const [rankTab, setRankTab] = useState<"day" | "speed">("day");
  const [speedRows, setSpeedRows] = useState<DailyLeaderRow[]>([]);
  const [speedBest, setSpeedBest] = useState<number | null>(null);
  const [onlinePlayers, setOnlinePlayers] = useState<OnlinePlayer[]>([]);
  const [bankCount, setBankCount] = useState<number>(1660);

  // PRC sprint state (preserves existing players' PRC records)
  const [prcActive, setPrcActive] = useState(false);
  const [prcTarget, setPrcTarget] = useState(0);
  const [prcInput, setPrcInput] = useState("");
  const [prcCount, setPrcCount] = useState(0);
  const [prcWrong, setPrcWrong] = useState(0);
  const [prcTimeLeft, setPrcTimeLeft] = useState(PRC_SECONDS);
  const [prcBest, setPrcBest] = useState<number>(0);
  const [prcDone, setPrcDone] = useState(false);
  const prcTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const prcInputRef = useRef<HTMLInputElement>(null);
  const chatSectionRef = useRef<HTMLElement>(null);
  const ranksSectionRef = useRef<HTMLElement>(null);

  const loadLeaderboard = useCallback(async () => {
    try {
      const res = await fetch("/api/stats/daily");
      if (!res.ok) return;
      const data = await res.json();
      setRows(data.rows ?? []);
    } catch {
      /* ignore */
    }
  }, []);

  const loadSpeedBoard = useCallback(async () => {
    try {
      const res = await fetch("/api/speed");
      if (!res.ok) return;
      const data = await res.json();
      setSpeedRows(data.rows ?? []);
      const mine = (data.rows ?? []).find((r: DailyLeaderRow) => r.id === data.me);
      if (mine) setSpeedBest(mine.correct);
    } catch {
      /* ignore */
    }
  }, []);

  const loadOnlinePlayers = useCallback(async () => {
    try {
      const res = await fetch("/api/players");
      if (!res.ok) return;
      const data = await res.json();
      setOnlinePlayers(data.players ?? []);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        setName(d.name);
        if (typeof d.prc === "number") setMyPrc(d.prc);
        if (typeof d.winsAllTime === "number") setMyWins(d.winsAllTime);
        if (d.isAdmin) setIsAdmin(true);
        if (typeof d.siteOff === "boolean") setSiteOff(d.siteOff);
      })
      .catch(() => {});
    fetch(`/api/questions?meta=1&lang=${lang}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d?.totalCount && setBankCount(d.totalCount))
      .catch(() => {});
    loadLeaderboard();
    loadSpeedBoard();
    loadOnlinePlayers();
    const best = parseInt(localStorage.getItem(PRC_BEST_KEY) || "0", 10);
    if (!isNaN(best)) setPrcBest(best);
    const lbTimer = setInterval(loadLeaderboard, 15000);
    const playersTimer = setInterval(loadOnlinePlayers, 15000);
    return () => {
      clearInterval(lbTimer);
      clearInterval(playersTimer);
    };
  }, [lang, loadLeaderboard, loadOnlinePlayers]);

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  };

  const startPrc = () => {
    setPrcActive(true);
    setPrcDone(false);
    setPrcCount(0);
    setPrcWrong(0);
    setPrcTimeLeft(PRC_SECONDS);
    setPrcTarget(Math.floor(Math.random() * 10000));
    setPrcInput("");
    if (prcTimer.current) clearInterval(prcTimer.current);
    prcTimer.current = setInterval(() => {
      setPrcTimeLeft((t) => {
        if (t <= 1) {
          if (prcTimer.current) clearInterval(prcTimer.current);
          return 0;
        }
        return t - 1;
      });
    }, 1000);
    setTimeout(() => prcInputRef.current?.focus(), 60);
  };

  const closePrc = () => {
    if (prcTimer.current) clearInterval(prcTimer.current);
    prcTimer.current = null;
    setPrcActive(false);
    setPrcDone(false);
    setPrcInput("");
  };

  const submitPrc = () => {
    const val = parseInt(prcInput.trim(), 10);
    if (isNaN(val)) return;
    if (val === prcTarget) {
      setPrcCount((c) => c + 1);
    } else {
      setPrcWrong((w) => w + 1);
    }
    setPrcTarget(Math.floor(Math.random() * 10000));
    setPrcInput("");
    prcInputRef.current?.focus();
  };

  useEffect(() => {
    if (prcTimeLeft === 0 && prcActive) {
      setPrcActive(false);
      setPrcDone(true);
      setPrcBest((prev) => {
        const newBest = Math.max(prev, prcCount);
        localStorage.setItem(PRC_BEST_KEY, String(newBest));
        return newBest;
      });
      fetch("/api/stats/daily", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ win: prcCount >= 5, correct: prcCount, wrong: prcWrong }),
      })
        .then(() => loadLeaderboard())
        .catch(() => {});
      // persist the sprint itself so it lands on the all-time speed board
      fetch("/api/speed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ correct: prcCount, wrong: prcWrong, seconds: PRC_SECONDS }),
      })
        .then(() => loadSpeedBoard())
        .catch(() => {});
    }
  }, [prcTimeLeft, prcActive, prcCount, prcWrong, loadLeaderboard, loadSpeedBoard]);

  const toggleSiteOff = useCallback(async () => {
    const goingOff = !siteOff;
    const ok = window.confirm(goingOff ? t("siteOffConfirm") : t("siteOnConfirm"));
    if (!ok) return;
    try {
      const res = await fetch("/api/admin/site-off", { method: "POST" });
      if (!res.ok) return;
      const d = await res.json();
      setSiteOff(Boolean(d.off));
    } catch {
      /* ignore */
    }
  }, [siteOff, t]);

  const heroName = name || "Champion";

  return (
    <div className="arena-backdrop min-h-screen w-full flex flex-col justify-between pb-24 lg:pb-20">
      <InviteToast />

      {/* ================= TOP ROYAL HUD BAR ================= */}
      <header className="w-full max-w-[1480px] mx-auto px-3 sm:px-6 pt-3 pb-1 flex flex-wrap items-center justify-between gap-3 z-20">
        {/* Player Avatar Medallion (keeps existing player account name & PRC record) */}
        <div className="flex items-center gap-3 royal-panel rounded-2xl px-3 py-2 pr-4">
          <div className="relative shrink-0">
            <div className="w-12 h-12 rounded-full border-2 border-[#f2c86b] overflow-hidden shadow-[0_0_16px_rgba(242,200,107,0.45)] bg-[#1c1420]">
              <img src={art.avatar} alt="Hero avatar" className="w-full h-full object-cover" />
            </div>
            <span
              className="absolute -bottom-1 -left-1 px-1.5 h-5 rounded-full bg-gradient-to-b from-[#f7d277] to-[#9c6419] border border-[#fff2c2] text-[#1a0f05] font-cinzel font-extrabold text-[0.6rem] flex items-center justify-center shadow"
              title={lang === "ro" ? "Victorii din toate timpurile" : "All-time wins"}
            >
              🏆{myWins}
            </span>
          </div>
          <div className="min-w-[130px]">
            <div className="flex items-center gap-1.5">
              <span className="font-cinzel font-bold text-[#ffefc8] text-sm tracking-wide truncate max-w-[140px]">
                {heroName}
              </span>
              <span className="text-[#f5c85c] text-xs">👑</span>
            </div>
            <div className="flex items-center gap-2 text-[0.68rem] text-[#cbb07e]">
              <span>
                PRC <strong className="text-[#ffe28a]">{myPrc != null ? myPrc : "—"}</strong>
              </span>
              <span className="opacity-40">·</span>
              <span>
                🏆 <strong className="text-[#ffe28a]">{myWins}</strong>{" "}
                {lang === "ro" ? "victorii" : "wins"}
              </span>
            </div>
          </div>
        </div>

        {/* Center Gilded Crest Banner: STONE QUIZ (clean title, no tagline) */}
        <div className="order-3 xl:order-2 w-full xl:w-auto flex flex-col items-center text-center my-1 xl:my-0 bg-[#120d19]/78 backdrop-blur-[2px] border border-[#b68635]/65 rounded-2xl px-8 py-2.5 shadow-xl">
          <h1 className="font-cinzel font-extrabold text-2xl sm:text-3xl lg:text-4xl tracking-[0.16em] gold-title leading-none !mb-0">
            {t("brandTitle")}
          </h1>
        </div>

        {/* Right Controls: Bank Badge + Art Theme Toggle + Language Switcher + Sign Out */}
        <div className="order-2 xl:order-3 flex items-center gap-2 flex-wrap justify-end">
          <div className="hidden md:flex items-center gap-2 royal-panel rounded-xl px-3 py-1.5 text-xs font-cinzel">
            <span className="flex items-center gap-1 text-[#ffd977] font-bold">
              <span>📚</span> {bankCount}
            </span>
          </div>

          <ThemeSwitcher />
          <LanguageSwitcher compact />

          {isAdmin && (
            <button
              type="button"
              onClick={toggleSiteOff}
              title={siteOff ? t("siteOnTitle") : t("siteOffTitle")}
              aria-label={siteOff ? t("siteOnTitle") : t("siteOffTitle")}
              className={`font-cinzel font-bold text-xs rounded-xl px-3 py-1.5 border-2 cursor-pointer transition-all ${
                siteOff
                  ? "text-[#8ef0b0] border-[#2f7a4e] bg-[#10251a] hover:brightness-125"
                  : "text-[#e9b48b] border-[#8a4322] bg-[#2a1108] hover:text-[#ff8b6b]"
              }`}
            >
              ⏻ {siteOff ? "ON" : "OFF"}
            </button>
          )}

          <button
            onClick={logout}
            className="royal-panel hover:border-[#f5cd71] rounded-xl px-3 py-1.5 text-xs font-cinzel font-bold tracking-wider text-[#f7e1b0] hover:text-white cursor-pointer transition-all"
          >
            {t("logout")}
          </button>
        </div>
      </header>

      {/* ================= MAIN 2-COLUMN LAYOUT (NO LEFT MENU, NO MISIUNI ZILNICE): TALL CHAT LEFT + GAMES & CLASAMENT RIGHT ================= */}
      <main className="w-full max-w-[1480px] mx-auto px-3 sm:px-6 mt-3 flex-1 grid grid-cols-1 lg:grid-cols-[420px_1fr] xl:grid-cols-[460px_1fr] gap-4 items-start z-10">
        {/* ---- LEFT: LARGE GENERAL CHAT BOX (more messages visible at once) ---- */}
        <section
          ref={chatSectionRef}
          id="chat"
          className="flex flex-col min-w-0 h-[520px] lg:h-[calc(100vh-238px)] lg:min-h-[580px]"
        >
          <GeneralChat variant="page" className="!w-full !h-full" />
        </section>

        {/* ---- RIGHT STAGE: 4 GAME MODE CARDS + TRAINING BANNER + COMBINED LEADERBOARD & PRC ---- */}
        <section className="flex flex-col gap-4">
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-3.5">
            {/* Card 1: QUIZ FIGHTER */}
            <Link href="/fight" className="mode-card group aspect-[3/4] flex flex-col justify-end">
              <img
                src={art.cardDuel}
                alt={t("cardDuelTitle")}
                className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-[#09060b] via-[#120a14]/35 to-transparent" />
              <span className="absolute top-2.5 right-2.5 bg-gradient-to-r from-[#c81d25] to-[#e06a1e] border border-[#ffdf85] text-[#fff8e0] font-cinzel font-extrabold text-[0.6rem] tracking-widest px-2 py-0.5 rounded-full shadow-lg animate-gold-glow">
                ★ {t("cardDuelTag")}
              </span>
              <div className="relative z-10 p-3.5 text-center">
                <div className="font-cinzel font-extrabold text-base sm:text-lg tracking-wider gold-title">
                  {t("cardDuelTitle")}
                </div>
                <div className="text-[0.72rem] text-[#f3dfb4] font-semibold mt-0.5">
                  {t("cardDuelSub")}
                </div>
              </div>
            </Link>

            {/* Card 2: ASEDIUL CASTELULUI / TOWER SIEGE */}
            <Link href="/siege" className="mode-card group aspect-[3/4] flex flex-col justify-end">
              <img
                src={art.cardSiege}
                alt={t("cardSiegeTitle")}
                className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-[#09060b] via-[#1c0c08]/35 to-transparent" />
              <span className="absolute top-2.5 right-2.5 bg-gradient-to-r from-[#c81d25] to-[#e06a1e] border border-[#ffdf85] text-[#fff8e0] font-cinzel font-extrabold text-[0.6rem] tracking-widest px-2 py-0.5 rounded-full shadow-lg animate-gold-glow">
                🔥 {t("cardSiegeTag")}
              </span>
              <div className="relative z-10 p-3.5 text-center">
                <div className="font-cinzel font-extrabold text-base sm:text-lg tracking-wider gold-title">
                  {t("cardSiegeTitle")}
                </div>
                <div className="text-[0.72rem] text-[#f3dfb4] font-semibold mt-0.5">
                  {t("cardSiegeSub")}
                </div>
              </div>
            </Link>

            {/* Card 3: TURNUL (Multiplayer 2-6 Players) */}
            <Link href="/turnul" className="mode-card group aspect-[3/4] flex flex-col justify-end">
              <img
                src={art.cardTurnul}
                alt={t("cardTurnulTitle")}
                className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-[#09060b] via-[#140a1e]/35 to-transparent" />
              <span className="absolute top-2.5 left-2.5 bg-[#120d1c]/85 border border-[#e3b559]/75 text-[#ffe399] font-cinzel font-bold text-[0.6rem] tracking-wider px-2 py-0.5 rounded-full">
                👥 {t("cardTurnulTag")}
              </span>
              <div className="relative z-10 p-3.5 text-center">
                <div className="font-cinzel font-extrabold text-base sm:text-lg tracking-wider gold-title">
                  {t("cardTurnulTitle")}
                </div>
                <div className="text-[0.72rem] text-[#f3dfb4] font-semibold mt-0.5">
                  {t("cardTurnulSub")}
                </div>
              </div>
            </Link>

            {/* Card 4: PRC SPRINT */}
            <button
              type="button"
              onClick={startPrc}
              className="mode-card group aspect-[3/4] flex flex-col justify-end text-left cursor-pointer"
            >
              <img
                src={art.cardPrc}
                alt={t("cardPrcTitle")}
                className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-[#09060b] via-[#1b1208]/35 to-transparent" />
              {prcBest > 0 && (
                <span className="absolute top-2.5 right-2.5 bg-[#120d1c]/85 border border-[#e3b559]/75 text-[#ffe399] font-cinzel font-bold text-[0.62rem] px-2 py-0.5 rounded-full">
                  ★ {prcBest}
                </span>
              )}
              <div className="relative z-10 p-3.5 text-center w-full">
                <div className="font-cinzel font-extrabold text-base sm:text-lg tracking-wider gold-title">
                  {t("cardPrcTitle")}
                </div>
                <div className="text-[0.72rem] text-[#f3dfb4] font-semibold mt-0.5">
                  {t("cardPrcSub")}
                </div>
              </div>
            </button>

            {/* Card 5: ANTRENAMENT (equal-sized card on row 2, no subtitle) */}
            <Link href="/train" className="mode-card group aspect-[3/4] flex flex-col justify-end">
              <img
                src={art.cardTrain}
                alt={t("trainingBannerTitle")}
                className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-[#09060b] via-[#0e1526]/35 to-transparent" />
              <div className="relative z-10 p-3.5 text-center w-full">
                <div className="font-cinzel font-extrabold text-base sm:text-lg tracking-wider gold-title">
                  {t("trainingBannerTitle")}
                </div>
              </div>
            </Link>
          </div>

          {/* Bottom Grid: Clasamentul Zilei + Online Players */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-[0.95fr_1fr_0.9fr] gap-4">
            {/* Clasamentul Zilei (narrower) */}
            <section ref={ranksSectionRef} className="royal-panel rounded-2xl p-3.5 flex flex-col gap-2.5 min-h-[260px]">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-[#b68635]/40 pb-2">
                <Link
                  href="/leaderboard"
                  className="min-w-0 font-cinzel font-bold text-[#f7d279] hover:text-[#fff0b3] text-[0.7rem] tracking-[0.1em] uppercase flex items-center gap-1.5 whitespace-nowrap"
                >
                  <span>👑</span> {t("leaderboardTitle")}
                </Link>
                <div className="flex items-center gap-1.5 shrink-0 ml-auto">
                  <button
                    onClick={() => setRankTab("day")}
                    className={`text-[0.62rem] font-cinzel px-1.5 py-0.5 rounded border cursor-pointer ${
                      rankTab === "day"
                        ? "text-[#1a0f05] bg-[#e8bf65] border-[#fff2c2] font-bold"
                        : "text-[#d6b77f] border-[#7a5828]/60 hover:text-[#ffe49e]"
                    }`}
                  >
                    {t("leaderboardTabDay")}
                  </button>
                  <button
                    onClick={() => {
                      setRankTab("speed");
                      loadSpeedBoard();
                    }}
                    className={`text-[0.62rem] font-cinzel px-1.5 py-0.5 rounded border cursor-pointer ${
                      rankTab === "speed"
                        ? "text-[#04121c] bg-[#7fd8ff] border-[#d6f4ff] font-bold"
                        : "text-[#d6b77f] border-[#7a5828]/60 hover:text-[#ffe49e]"
                    }`}
                  >
                    ⚡ {t("leaderboardTabSpeed")}
                  </button>
                  <Link
                    href="/leaderboard"
                    className="text-[0.65rem] font-cinzel text-[#d6b77f] hover:text-[#ffe49e] underline"
                  >
                    {lang === "ro" ? "Tot" : "All"}
                  </Link>
                  <button
                    onClick={() => (rankTab === "day" ? loadLeaderboard() : loadSpeedBoard())}
                    className="text-[#d6b77f] hover:text-[#ffe49e] text-sm cursor-pointer transition-colors"
                    title={t("refresh")}
                  >
                    ⟳
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto flex flex-col gap-1.5 max-h-[240px]">
                {(rankTab === "day" ? rows : speedRows).length === 0 ? (
                  <div className="text-[#b89f72] text-xs text-center my-auto p-4">
                    {rankTab === "day" ? t("leaderboardEmpty") : t("leaderboardSpeedEmpty")}
                  </div>
                ) : (
                  (rankTab === "day" ? rows : speedRows).map((r, i) => (
                    <div
                      key={(r.id || r.name) + i}
                      className="grid grid-cols-[22px_minmax(0,1fr)_auto_auto] gap-1.5 text-[11px] px-2 py-1.5 rounded-lg items-center bg-[#120e1a]/70 border border-[#7a5828]/30"
                    >
                      <span
                        className={`font-cinzel font-extrabold text-center ${
                          i === 0
                            ? "text-[#ffd85c]"
                            : i === 1
                            ? "text-[#dce4f0]"
                            : i === 2
                            ? "text-[#e49b56]"
                            : "text-[#9c845d]"
                        }`}
                      >
                        {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `#${i + 1}`}
                      </span>
                      <span className="font-cinzel font-bold truncate text-[#f6ead0]">{r.name}</span>
                      <span className="text-[#f7cf70] font-bold whitespace-nowrap">
                        {rankTab === "day" ? `🏆 ${r.wins ?? 0}` : `⚡ ${r.correct}`}
                      </span>
                      <span
                        className="font-mono text-[10px] bg-[#0c0a14] border border-[#7a5828]/40 rounded px-1.5 py-0.5 whitespace-nowrap"
                        title={r.accuracy != null ? `${r.accuracy}%` : undefined}
                      >
                        <span className="text-emerald-400 font-bold">{r.correct}✓</span>
                        <span className="text-[#8e7a56] mx-0.5">/</span>
                        <span className="text-rose-400 font-bold">{r.wrong}✗</span>
                      </span>
                    </div>
                  ))
                )}
              </div>
            </section>

            {/* Jucători Online */}
            <section className="royal-panel rounded-2xl p-3.5 flex flex-col gap-2.5 min-h-[260px]">
              <div className="flex items-center justify-between border-b border-[#b68635]/40 pb-2 gap-2">
                <h3 className="font-cinzel font-bold text-[#f7d279] text-xs tracking-[0.12em] uppercase flex items-center gap-1.5 truncate">
                  <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399]" />
                  {lang === "ro" ? "Jucători online" : "Online Players"}
                </h3>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[0.65rem] font-cinzel font-bold text-emerald-300 bg-emerald-950/60 border border-emerald-500/40 rounded-full px-2 py-0.5">
                    {onlinePlayers.filter((p) => p.online).length}
                  </span>
                  <button
                    onClick={loadOnlinePlayers}
                    className="text-[#d6b77f] hover:text-[#ffe49e] text-sm cursor-pointer transition-colors"
                    title={t("refresh")}
                  >
                    ⟳
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto flex flex-col gap-1.5 max-h-[240px]">
                {onlinePlayers.length === 0 ? (
                  <div className="text-[#b89f72] text-xs text-center my-auto p-4">
                    {lang === "ro" ? "Niciun jucător online momentan." : "No online players right now."}
                  </div>
                ) : (
                  onlinePlayers
                    .slice()
                    .sort((a, b) => Number(Boolean(b.online)) - Number(Boolean(a.online)))
                    .map((p) => (
                      <div
                        key={p.id}
                        className={`flex items-center justify-between gap-2 text-xs px-2.5 py-1.5 rounded-lg border ${
                          p.online
                            ? "bg-[#120e1a]/80 border-[#7a5828]/40"
                            : "bg-[#0d0a13]/50 border-[#7a5828]/20 opacity-60"
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className={`w-2 h-2 rounded-full shrink-0 ${
                              p.online ? "bg-emerald-400 shadow-[0_0_6px_#34d399]" : "bg-[#6b5c43]"
                            }`}
                          />
                          <span
                            className="font-cinzel font-bold truncate"
                            style={{ color: p.color || "#f6ead0" }}
                          >
                            {p.name}
                          </span>
                        </div>
                        <span className="text-[10px] font-cinzel shrink-0 text-[#c9b285]">
                          {p.where
                            ? p.where === "tower"
                              ? "🗼 Turnul"
                              : "⚔️ În joc"
                            : p.online
                            ? "Online"
                            : "Offline"}
                        </span>
                      </div>
                    ))
                )}
              </div>
            </section>

          </div>
        </section>
      {(prcActive || prcDone) && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" role="dialog" aria-modal="true">
          <div className="royal-panel rounded-2xl p-5 w-full max-w-sm flex flex-col gap-3 relative">
            <button onClick={closePrc} className="absolute right-3 top-3 h-6 w-6 rounded-md border border-[#7a4e22] bg-[#2a1608] text-[#c8a070] text-[0.7rem] cursor-pointer" aria-label="X">✕</button>
            <div className="flex items-center justify-between border-b border-[#b68635]/40 pb-2 pr-8">
              <h3 className="font-cinzel font-bold text-[#f7d279] text-xs tracking-[0.14em] uppercase">⚡ {t("prcTitle")}</h3>
              {prcBest > 0 && (<span className="text-[0.68rem] font-cinzel text-[#ffd977] bg-[#2a1c0d] border border-[#b68635]/60 rounded-full px-2 py-0.5">★ {prcBest}</span>)}
            </div>
            {prcActive && (
              <div className="flex flex-col gap-2.5">
                <div className="text-center font-cinzel font-extrabold text-4xl gold-title py-1">{prcTarget}</div>
                <div className="text-center text-xs text-[#d6be92]">{t("prcTimeLeft")} <strong className="text-[#ffcf67]">{prcTimeLeft}s</strong> · {t("prcCorrect")} <strong className="text-[#72e68a]">{prcCount}</strong></div>
                <input ref={prcInputRef} type="number" value={prcInput} onChange={(e) => setPrcInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submitPrc()} autoFocus className="bg-[#0b0910] border-2 border-[#c9943b] rounded-xl text-[#ffebb8] text-2xl font-bold text-center p-3 outline-none focus:border-[#ffe28a]" />
              </div>
            )}
            {prcDone && (
              <div className="flex flex-col gap-2.5 text-center">
                <div className="font-cinzel font-extrabold text-3xl gold-title">{prcCount} {t("prcCorrect")}</div>
                <div className="text-xs text-[#d6be92]">{t("prcWrong")} {prcWrong} · {t("prcRecord")} <strong>{prcBest}</strong></div>
                <button onClick={startPrc} className="btn-crimson rounded-xl font-cinzel font-bold text-xs tracking-[0.14em] uppercase py-2.5 cursor-pointer">{t("prcAgain")}</button>
                <button onClick={closePrc} className="text-[0.7rem] font-cinzel text-[#c8a070] hover:text-[#ffe28a] underline underline-offset-2 cursor-pointer">{t("close")}</button>
              </div>
            )}
          </div>
        </div>
      )}
    </main>

      {/* ================= BOTTOM BAR WITH ALL NAVIGATION OPTIONS ================= */}
      <footer className="fixed bottom-0 inset-x-0 z-30 bg-gradient-to-t from-[#090810] via-[#12101d]/95 to-[#1a1527]/90 border-t-2 border-[#b68635]/80 shadow-[0_-8px_28px_rgba(0,0,0,0.8)]">
        <div className="max-w-[1480px] mx-auto px-3 sm:px-6 py-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 sm:gap-4 lg:gap-6 overflow-x-auto">
            <Link
              href="/fight"
              className="flex flex-col items-center text-[0.65rem] font-cinzel text-[#f3dfb4] hover:text-[#ffe396] transition-colors px-1.5 shrink-0"
            >
              <span className="text-lg">⚔️</span>
              <span>{t("bottomDuel")}</span>
            </Link>
            <Link
              href="/siege"
              className="flex flex-col items-center text-[0.65rem] font-cinzel text-[#f3dfb4] hover:text-[#ffe396] transition-colors px-1.5 shrink-0"
            >
              <span className="text-lg">🔥</span>
              <span>{t("bottomSiege")}</span>
            </Link>
            <Link
              href="/turnul"
              className="flex flex-col items-center text-[0.65rem] font-cinzel text-[#f3dfb4] hover:text-[#ffe396] transition-colors px-1.5 shrink-0"
            >
              <span className="text-lg">🗼</span>
              <span>{t("bottomTurnul")}</span>
            </Link>
            <Link
              href="/train"
              className="flex flex-col items-center text-[0.65rem] font-cinzel text-[#f3dfb4] hover:text-[#ffe396] transition-colors px-1.5 shrink-0"
            >
              <span className="text-lg">🎓</span>
              <span>{t("bottomTrivia")}</span>
            </Link>
            <button
              type="button"
              onClick={startPrc}
              className="flex flex-col items-center text-[0.65rem] font-cinzel text-[#f3dfb4] hover:text-[#ffe396] transition-colors px-1.5 cursor-pointer shrink-0"
            >
              <span className="text-lg">⚡</span>
              <span>{t("bottomPrc")}</span>
            </button>
            <Link
              href="/leaderboard"
              className="flex flex-col items-center text-[0.65rem] font-cinzel text-[#f3dfb4] hover:text-[#ffe396] transition-colors px-1.5 shrink-0"
            >
              <span className="text-lg">🏆</span>
              <span>{t("bottomRanks")}</span>
            </Link>
            <button
              type="button"
              onClick={() => chatSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })}
              className="flex flex-col items-center text-[0.65rem] font-cinzel text-[#f3dfb4] hover:text-[#ffe396] transition-colors px-1.5 cursor-pointer shrink-0"
            >
              <span className="text-lg">💬</span>
              <span>{t("bottomChat")}</span>
            </button>
            {isAdmin && (
              <Link
                href="/admin"
                className="flex flex-col items-center text-[0.65rem] font-cinzel text-[#ffd977] hover:text-white transition-colors px-1.5 shrink-0"
              >
                <span className="text-lg">🛡</span>
                <span>Admin</span>
              </Link>
            )}
          </div>

          <Link
            href="/siege"
            className="btn-crimson shrink-0 rounded-xl px-5 sm:px-8 py-2.5 font-cinzel font-extrabold text-xs sm:text-sm tracking-[0.16em] uppercase flex items-center gap-2 animate-gold-glow"
          >
            <span>🔥</span>
            <span>{t("playNow")}</span>
          </Link>
        </div>
      </footer>
    </div>
  );
}
