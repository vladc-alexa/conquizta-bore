"use client";

import React, { createContext, useContext, useEffect, useState } from "react";

export type Lang = "ro" | "en";

const STORAGE_KEY = "stone_quiz_lang";

export const TRANSLATIONS = {
  ro: {
    brandTitle: "STONE QUIZ",
    logout: "Ieșire",
    siteOffTitle: "Oprește site-ul (mentenanță)",
    siteOnTitle: "Repornește site-ul",
    siteOffConfirm: "Oprești site-ul? Doar adminii vor mai vedea ceva.",
    siteOnConfirm: "Repornești site-ul pentru toată lumea?",
    level: "Jucător",
    navHome: "Acasă",
    navDuel: "Quiz Fighter",
    navSiege: "Asediul Castelului",
    navTurnul: "Turnul",
    navTrain: "Antrenament",
    navLeaderboard: "Clasament",
    navChat: "Chat General",
    navPrc: "Măsoară viteza",
    playNow: "JOACĂ ACUM",
    cardDuelTitle: "QUIZ FIGHTER",
    cardDuelSub: "Duel 1 vs 1 cu Întrebări",
    cardDuelTag: "1 VS 1",
    cardSiegeTitle: "ASEDIUL CASTELULUI",
    cardSiegeSub: "Catapulte • 3 Turnuri • Grilă",
    cardSiegeTag: "NOU",
    cardTurnulTitle: "TURNUL",
    cardTurnulSub: "Multiplayer 2–6 Jucători",
    cardTurnulTag: "MULTIPLAYER",
    cardGrilaTitle: "BĂTĂLIA GRILĂ",
    cardGrilaSub: "500+ Întrebări Traduse",
    cardRapideTitle: "ÎNTREBĂRI RAPIDE",
    cardRapideSub: "Răspunsuri Numerice",
    cardPrcTitle: "MĂSOARĂ VITEZA",
    cardPrcSub: "Test Viteză 30s",
    trainingBannerTitle: "ANTRENAMENT",
    trainingBannerSub: "Grile • Rapide • 500+ Întrebări • Invită Prieteni sau Boți",
    dailyMissions: "Misiuni zilnice",
    mission1: "Dărâmă un castel în Asediul Castelului",
    mission2: "Câștigă un duel în Quiz Fighter",
    mission3: "Urcă în vârful Turnului",
    leaderboardTitle: "Clasamentul zilei",
    leaderboardEmpty: "Niciun joc terminat azi. Joacă-te!",
    leaderboardTabDay: "Azi",
    leaderboardTabSpeed: "Vitez\u0103",
    leaderboardSpeedEmpty: "Niciun sprint \u00eenregistrat \u00eenc\u0103.",
    wins: "victorii",
    refresh: "Reîmprospătează",
    chatTitle: "Chat general",
    chatMessages: "mesaje",
    chatEmpty: "Niciun mesaj încă. Spune salut!",
    chatPlaceholder: "Mesaj către regat…",
    chatSend: "Trimite",
    prcTitle: "Măsoară viteza",
    prcDesc: "Scrie cât mai multe numere corect în 30 de secunde.",
    prcBest: "Record personal:",
    prcStart: "Începe",
    prcTimeLeft: "Timp rămas:",
    prcCorrect: "Corecte:",
    prcWrong: "Greșite:",
    prcRecord: "Record:",
    prcAgain: "Încă o dată",
    bottomRanks: "Clasament",
    bottomTrivia: "Antrenament",
    bottomDuel: "Quiz Fighter",
    bottomSiege: "Asediu",
    bottomTurnul: "Turnul",
    bottomPrc: "Viteză",
    bottomChat: "Chat",
    // Login
    loginSubtitle: "Autentificare Stone Quiz",
    loginEmail: "Email",
    loginEmailPlaceholder: "tu@exemplu.ro",
    loginPassword: "Parolă",
    loginSubmit: "Intră în Joc",
    loginLoading: "Se autentifică…",
    loginDemoHint: "Acces local rapid: test@test.com / test",
    loginFailed: "Autentificare eșuată.",
    loginNetError: "Eroare de rețea. Încearcă din nou.",
    // Online Lobby & Invites (shared across all modes)
    lobbyTitle: "Sală de Joc — Invită Jucători sau Boți",
    lobbyRoomCode: "Cod Cameră",
    lobbyCopyLink: "Copiază Link Invitație",
    lobbyCopied: "Copiat!",
    lobbyJoinCode: "Cod cameră…",
    lobbyJoinBtn: "Intră",
    lobbySeats: "Locuri în Meci",
    lobbyEmptySeat: "Loc Liber",
    lobbyAddBot: "+ Bot",
    lobbyFillBots: "Umple Locurile cu Boți",
    lobbyOnlinePlayers: "Jucători Online",
    lobbyNoOnline: "Niciun alt jucător online acum — poți distribui linkul sau umple cu boți.",
    lobbyInviteBtn: "Invită",
    lobbyInvited: "Invitat ✓",
    lobbyHost: "Gazdă",
    lobbyBot: "BOT",
    lobbyRemove: "Scoate",
    lobbyInviteToastTitle: "Invitație la Joc!",
    lobbyInviteToastAccept: "Acceptă & Intră",
    lobbyInviteToastDecline: "Refuză",
    lobbyBotDiff: "Dificultate Boți",
    lobbyDiffEasy: "Scutier",
    lobbyDiffMedium: "Cavaler",
    lobbyDiffHard: "Senior",
    lobbyNeedPlayers: "Adaugă cel puțin un adversar (online sau bot) pentru a începe!",
    // Train page
    trainTitle: "ANTRENAMENT",
    trainSubtitle: "Exersează solo sau provoacă jucători online și boți",
    trainBackHome: "Înapoi Acasă",
    trainGrilaTitle: "Întrebări Grilă",
    trainGrilaDesc: "Alege una din cele 4 variante din banca de 500+ întrebări. 10s / întrebare.",
    trainRapideTitle: "Întrebări Rapide",
    trainRapideDesc: "Scrie răspunsul numeric exact (poate fi negativ). 10s / întrebare.",
    trainCategoryLabel: "Categorie",
    trainAllCategories: "Toate Categoriile",
    trainCountLabel: "Întrebări",
    trainLoading: "Se încarcă întrebările…",
    trainFinished: "Terminat!",
    trainCorrect: "Corecte",
    trainWrong: "Greșite",
    trainTimeouts: "Timp expirat",
    trainPlayAgain: "Încă o dată",
    trainChangeMode: "Schimbă modul",
    trainQuestionOf: "Întrebarea",
    trainNumericPlaceholder: "Răspuns numeric…",
    trainCorrectMsg: "Corect!",
    trainWrongMsg: "Greșit!",
    trainTimeoutMsg: "Timp expirat!",
    trainCorrectAnswer: "Răspuns corect:",
    trainNoQuestions: "Nu există întrebări pentru acest filtru.",
    trainBankBadge: "Bancă Întrebări",
    trainRivalsTitle: "Clasament Sală",
    // Quiz Fighter Mini-Game
    fightTitle: "QUIZ FIGHTER",
    fightSubtitle: "Duel 1 vs 1 — Răspunde la întrebări pentru a declanșa atacurile!",
    fightMode1P: "1J vs Bot / Online",
    fightMode2P: "2J Local (Pe Rând)",
    fightDiffLabel: "Dificultate AI",
    fightDiffEasy: "Scutier",
    fightDiffMedium: "Cavaler",
    fightDiffHard: "Senior",
    fightSelectP1: "Luptător Jucător 1",
    fightSelectP2: "Luptător Adversar",
    fightStartMatch: "ÎNCEPE LUPTA!",
    fightBackLobby: "Înapoi la Stone Quiz",
    fightSoundOn: "Sunet Pornit",
    fightSoundOff: "Fără Sunet",
    fightHowItWorks: "Răspunde corect și rapid la fiecare întrebare pentru a lansa lovituri, combo-uri și atacuri Speciale! Greșelile permit adversarului să contraatace.",
    fightRound: "RUNDA",
    fightKO: "K.O.!",
    fightPerfect: "PERFECT!",
    fightWinsMatch: "CÂȘTIGĂ DUELUL!",
    fightRematch: "Revanșă",
    fightChangeFighters: "Schimbă Luptătorii",
    fightSuperReady: "SUPER GATA!",
    fightCombo: "COMBO!",
    fightTurnP1: "Rândul Jucătorului 1 — Răspunde pentru a ataca!",
    fightTurnP2: "Rândul Jucătorului 2 — Răspunde pentru a ataca!",
    fightAnswerPrompt: "Răspunde rapid (taste 1-4 sau click) pentru a lansa atacul!",
    fightQuestionLabel: "ÎNTREBARE DE ATAC",
    fightCorrectStrike: "LOVITURĂ REUȘITĂ!",
    fightFastCrit: "LOVITURĂ CRITICĂ RAPIDĂ!",
    fightSuperStrike: "ATAC SPECIAL DEZLĂNȚUIT!",
    fightBlockedClash: "CLASH! AMÂNDOI CORECT — LOVITURĂ PARȚIALĂ!",
    fightCounterHit: "GREȘIT! ADVERSARUL CONTRAATACĂ!",
    fightTimeoutCounter: "TIMP EXPIRAT! ADVERSARUL ATACĂ!",
    fightBothMiss: "AMÂNDOI AU GREȘIT — FĂRĂ DAUNE!",
    fightAnswerWas: "Răspuns corect:",
    // Tower Siege / Asediul Castelului
    siegeTitle: "ASEDIUL CASTELULUI",
    siegeSubtitle: "Catapulte 1 vs 1 • 3 Turnuri (2 lovituri / turn) • Grilă + Departajare Rapidă",
    siegeStart: "ÎNCEPE ASEDIUL!",
    siegeHowItWorks: "Fiecare castel are 3 turnuri cu câte 2 puncte de viață (2 lovituri dărâmă un turn). Răspunde la întrebări Grilă; în caz de egalitate, câștigătorul se decide la o Întrebare Rapidă numerică!",
    siegeTargetHint: "Click pe un turn inamic în picioare pentru a-l ținti cu catapulta",
    siegeGrilaPhase: "ÎNTREBARE GRILĂ DE ASEDIU",
    siegeTiebreakerPhase: "⚡ EGALITATE! DEPARTAJARE — ÎNTREBARE RAPIDĂ!",
    siegeTiebreakerDesc: "Amândoi ați răspuns corect! Cel mai aproape de răspunsul numeric exact trage cu catapulta!",
    siegeFiring: "CATAPULTA TRAGE!",
    siegeDirectHit: "LOVITURĂ DIRECTĂ! TURN AVARIAT!",
    siegeTowerDown: "💥 TURN DĂRÂMAT! RUINE ÎN FLĂCĂRI!",
    siegeBothWrong: "AMÂNDOI AU GREȘIT — NICIO CATAPULTĂ NU TRAGE!",
    siegeWaitingStart: "Așteptăm celălalt jucător să apese START…",
    siegeWaitingAnswer: "Așteptăm răspunsul adversarului…",
    siegeBothReady: "Amândoi gata — asediul începe!",
    siegeRematchWaiting: "Așteptăm adversarul pentru revanșă…",
    siegeYouWonTie: "AI FOST MAI APROAPE! CATAPULTA TA TRAGE!",
    siegeOppWonTie: "ADVERSARUL A FOST MAI APROAPE! CATAPULTA INAMICĂ TRAGE!",
    siegeCastleFallen: "CASTEL CUCERIT!",
    siegeVictory: "VICTORIE ÎN ASEDIU!",
    siegeDefeat: "CASTELUL TĂU A CĂZUT!",
    siegeTowersLeft: "Turnuri",
    siegeYourGuess: "Răspunsul tău",
    siegeOppGuess: "Adversar",
    // Turnul (Multiplayer Tower Climb)
    turnulTitle: "TURNUL",
    turnulSubtitle: "Ascensiune Multiplayer (2–6 Jucători) • Grafică & Sunet Îmbunătățit",
    turnulStart: "URCĂ ÎN TURN!",
    turnulHowItWorks: "2–6 jucători (online sau boți) urcă cele 10 etaje ale Turnului de Piatră! Răspunsurile corecte te urcă un etaj, iar greșelile îți sparg un scut. Ultimul în picioare sau primul la Etajul 10 câștigă Coroana!",
    turnulFloor: "ETAJUL",
    turnulShields: "Scuturi",
    turnulEliminated: "ELIMINAT",
    turnulClimbing: "URCĂ!",
    turnulCrownWinner: "CUCERITORUL TURNULUI!",
    turnulNextFloor: "Etajul următor…",
    turnulGrilaRound: "PROBA GRILĂ",
    turnulRapideRound: "PROBA RAPIDĂ (NUMERICĂ)",
    turnulYouClimbed: "AI URCAT UN ETAJ!",
    turnulShieldBroken: "SCUT SPART!",
  },
  en: {
    brandTitle: "STONE QUIZ",
    logout: "Sign Out",
    siteOffTitle: "Switch the site off (maintenance)",
    siteOnTitle: "Switch the site back on",
    siteOffConfirm: "Switch the site off? Only admins will see anything.",
    siteOnConfirm: "Switch the site back on for everyone?",
    level: "Player",
    navHome: "Home",
    navDuel: "Quiz Fighter",
    navSiege: "Tower Siege",
    navTurnul: "The Tower",
    navTrain: "Training",
    navLeaderboard: "Leaderboard",
    navChat: "General Chat",
    navPrc: "Speed test",
    playNow: "PLAY NOW",
    cardDuelTitle: "QUIZ FIGHTER",
    cardDuelSub: "1 vs 1 Trivia Street Fighter",
    cardDuelTag: "1 VS 1",
    cardSiegeTitle: "TOWER SIEGE",
    cardSiegeSub: "Catapults • 3 Towers • Quiz",
    cardSiegeTag: "NEW",
    cardTurnulTitle: "THE TOWER",
    cardTurnulSub: "Multiplayer 2–6 Players",
    cardTurnulTag: "MULTIPLAYER",
    cardGrilaTitle: "ROYAL TRIVIA",
    cardGrilaSub: "500+ Open Trivia Questions",
    cardRapideTitle: "QUICK BLITZ",
    cardRapideSub: "Numeric Speed Duel",
    cardPrcTitle: "SPEED TEST",
    cardPrcSub: "30s Reflex Trial",
    trainingBannerTitle: "TRAINING GROUNDS",
    trainingBannerSub: "Multiple Choice • Rapid Numbers • 500+ Questions • Invite Friends or Bots",
    dailyMissions: "Daily Quests",
    mission1: "Demolish a castle in Tower Siege",
    mission2: "Win a Quiz Fighter duel",
    mission3: "Reach the summit of The Tower",
    leaderboardTitle: "Daily Leaderboard",
    leaderboardEmpty: "No battles finished today. Claim the throne!",
    leaderboardTabDay: "Today",
    leaderboardTabSpeed: "Speed",
    leaderboardSpeedEmpty: "No speed runs recorded yet.",
    wins: "wins",
    refresh: "Refresh",
    chatTitle: "General Chat",
    chatMessages: "messages",
    chatEmpty: "No messages yet. Say hello!",
    chatPlaceholder: "Message the realm…",
    chatSend: "Send",
    prcTitle: "Measure your speed",
    prcDesc: "Type as many matching numbers as possible in 30 seconds.",
    prcBest: "Personal best:",
    prcStart: "Begin Trial",
    prcTimeLeft: "Time left:",
    prcCorrect: "Correct:",
    prcWrong: "Missed:",
    prcRecord: "Best:",
    prcAgain: "Try Again",
    bottomRanks: "Rankings",
    bottomTrivia: "Training",
    bottomDuel: "Quiz Fighter",
    bottomSiege: "Siege",
    bottomTurnul: "Tower",
    bottomPrc: "Speed",
    bottomChat: "Chat",
    // Login
    loginSubtitle: "Sign In to Stone Quiz",
    loginEmail: "Email",
    loginEmailPlaceholder: "you@example.com",
    loginPassword: "Password",
    loginSubmit: "Enter Arena",
    loginLoading: "Signing in…",
    loginDemoHint: "Quick local access: test@test.com / test",
    loginFailed: "Authentication failed.",
    loginNetError: "Network error. Please try again.",
    // Online Lobby & Invites
    lobbyTitle: "Match Room — Invite Online Players or Fill with Bots",
    lobbyRoomCode: "Room Code",
    lobbyCopyLink: "Copy Invite Link",
    lobbyCopied: "Copied!",
    lobbyJoinCode: "Room code…",
    lobbyJoinBtn: "Join",
    lobbySeats: "Match Seats",
    lobbyEmptySeat: "Open Seat",
    lobbyAddBot: "+ Bot",
    lobbyFillBots: "Fill Empty Seats with Bots",
    lobbyOnlinePlayers: "Online Players",
    lobbyNoOnline: "No other players online right now — share the invite link or fill seats with bots.",
    lobbyInviteBtn: "Invite",
    lobbyInvited: "Invited ✓",
    lobbyHost: "Host",
    lobbyBot: "BOT",
    lobbyRemove: "Remove",
    lobbyInviteToastTitle: "Game Invitation!",
    lobbyInviteToastAccept: "Accept & Join",
    lobbyInviteToastDecline: "Decline",
    lobbyBotDiff: "Bot Difficulty",
    lobbyDiffEasy: "Squire",
    lobbyDiffMedium: "Knight",
    lobbyDiffHard: "Warlord",
    lobbyNeedPlayers: "Add at least one opponent (online player or bot) to begin!",
    // Train page
    trainTitle: "TRAINING",
    trainSubtitle: "Practice solo or challenge online players & bots",
    trainBackHome: "Back Home",
    trainGrilaTitle: "Multiple Choice Trivia",
    trainGrilaDesc: "Pick 1 of 4 answers from our 500+ Open Trivia question bank. 10s per question.",
    trainRapideTitle: "Quick Numeric Blitz",
    trainRapideDesc: "Type the exact numeric answer (can be negative). 10s per question.",
    trainCategoryLabel: "Category",
    trainAllCategories: "All Categories",
    trainCountLabel: "Questions",
    trainLoading: "Loading questions…",
    trainFinished: "Finished!",
    trainCorrect: "Correct",
    trainWrong: "Wrong",
    trainTimeouts: "Timed out",
    trainPlayAgain: "Play Again",
    trainChangeMode: "Switch Mode",
    trainQuestionOf: "Question",
    trainNumericPlaceholder: "Numeric answer…",
    trainCorrectMsg: "Correct!",
    trainWrongMsg: "Incorrect!",
    trainTimeoutMsg: "Time's Up!",
    trainCorrectAnswer: "Correct answer:",
    trainNoQuestions: "No questions matched that filter. Try All Categories.",
    trainBankBadge: "Question Bank",
    trainRivalsTitle: "Room Standings",
    // Quiz Fighter Mini-Game
    fightTitle: "QUIZ FIGHTER",
    fightSubtitle: "1 vs 1 Trivia Duel — Answer questions to unleash fighting combos!",
    fightMode1P: "1P vs Bot / Online",
    fightMode2P: "2P Local (Turn-Based)",
    fightDiffLabel: "AI Difficulty",
    fightDiffEasy: "Squire",
    fightDiffMedium: "Knight",
    fightDiffHard: "Warlord",
    fightSelectP1: "Player 1 Fighter",
    fightSelectP2: "Opponent Fighter",
    fightStartMatch: "START FIGHT!",
    fightBackLobby: "Back to Stone Quiz",
    fightSoundOn: "SFX On",
    fightSoundOff: "Muted",
    fightHowItWorks: "Answer each trivia question correctly and quickly to launch melee combos & elemental Special Waves! Wrong answers let your opponent counter-attack.",
    fightRound: "ROUND",
    fightKO: "K.O.!",
    fightPerfect: "PERFECT!",
    fightWinsMatch: "WINS THE DUEL!",
    fightRematch: "Rematch",
    fightChangeFighters: "Change Fighters",
    fightSuperReady: "SUPER READY!",
    fightCombo: "COMBO!",
    fightTurnP1: "Player 1's Turn — Answer to Strike!",
    fightTurnP2: "Player 2's Turn — Answer to Strike!",
    fightAnswerPrompt: "Answer quickly (keys 1-4 or click) to trigger your attack!",
    fightQuestionLabel: "STRIKE QUESTION",
    fightCorrectStrike: "CLEAN STRIKE!",
    fightFastCrit: "LIGHTNING CRITICAL HIT!",
    fightSuperStrike: "ULTIMATE SPECIAL UNLEASHED!",
    fightBlockedClash: "BLADE CLASH! BOTH RIGHT — GLANCING BLOW!",
    fightCounterHit: "WRONG! OPPONENT COUNTER-ATTACKS!",
    fightTimeoutCounter: "TIME UP! OPPONENT STRIKES!",
    fightBothMiss: "BOTH MISSED — NO DAMAGE!",
    fightAnswerWas: "Correct answer:",
    // Tower Siege
    siegeTitle: "TOWER SIEGE",
    siegeSubtitle: "1 vs 1 Catapults • 3 Towers (2 hits each) • Multiple Choice + Fast Tiebreaker",
    siegeStart: "LAUNCH SIEGE!",
    siegeHowItWorks: "Each castle has 3 towers with 2 HP each (2 direct hits demolish a tower). Answer multiple-choice questions; if tied, a Fast Numeric question decides who fires the catapult!",
    siegeTargetHint: "Click any standing enemy tower to aim your catapult",
    siegeGrilaPhase: "SIEGE MULTIPLE-CHOICE QUESTION",
    siegeTiebreakerPhase: "⚡ TIED! FAST NUMERIC TIEBREAKER!",
    siegeTiebreakerDesc: "Both answered correctly! Closest to the exact number fires the catapult!",
    siegeFiring: "CATAPULT FIRING!",
    siegeDirectHit: "DIRECT HIT! TOWER DAMAGED!",
    siegeTowerDown: "💥 TOWER DEMOLISHED! COLLAPSING IN FLAMES!",
    siegeBothWrong: "BOTH MISSED — NO CATAPULT FIRES!",
    siegeWaitingStart: "Waiting for the other player to press START…",
    siegeWaitingAnswer: "Waiting for your opponent’s answer…",
    siegeBothReady: "Both ready — the siege begins!",
    siegeRematchWaiting: "Waiting for your opponent to start the rematch…",
    siegeYouWonTie: "CLOSER GUESS! YOUR CATAPULT FIRES!",
    siegeOppWonTie: "OPPONENT WAS CLOSER! ENEMY CATAPULT FIRES!",
    siegeCastleFallen: "CASTLE CONQUERED!",
    siegeVictory: "SIEGE VICTORY!",
    siegeDefeat: "YOUR CASTLE FELL!",
    siegeTowersLeft: "Towers",
    siegeYourGuess: "Your guess",
    siegeOppGuess: "Opponent",
    // The Tower (Turnul)
    turnulTitle: "THE TOWER",
    turnulSubtitle: "Multiplayer Climb (2–6 Players) • Enhanced Visuals & Sound",
    turnulStart: "ASCEND THE TOWER!",
    turnulHowItWorks: "2–6 players (online or bots) race up the 10 floors of the Stone Tower! Right answers climb a floor, wrong answers shatter a shield. Last hero standing or first to Floor 10 claims the Crown!",
    turnulFloor: "FLOOR",
    turnulShields: "Shields",
    turnulEliminated: "ELIMINATED",
    turnulClimbing: "CLIMBING!",
    turnulCrownWinner: "TOWER CHAMPION!",
    turnulNextFloor: "Next floor…",
    turnulGrilaRound: "MULTIPLE CHOICE TRIAL",
    turnulRapideRound: "RAPID NUMERIC TRIAL",
    turnulYouClimbed: "FLOOR ASCENDED!",
    turnulShieldBroken: "SHIELD SHATTERED!",
  },
} as const;

export type TranslationKey = keyof typeof TRANSLATIONS.ro;

interface I18nContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: TranslationKey) => string;
}

const I18nContext = createContext<I18nContextValue>({
  lang: "ro",
  setLang: () => {},
  t: (key) => TRANSLATIONS.ro[key],
});

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>("ro");

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === "en" || saved === "ro") {
        setLangState(saved);
        document.documentElement.lang = saved;
      } else {
        document.documentElement.lang = "ro";
      }
    } catch {
      /* ignore */
    }
  }, []);

  const setLang = (next: Lang) => {
    setLangState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
      document.documentElement.lang = next;
    } catch {
      /* ignore */
    }
  };

  const t = (key: TranslationKey) => TRANSLATIONS[lang][key] ?? TRANSLATIONS.ro[key];

  return <I18nContext.Provider value={{ lang, setLang, t }}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}

export function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const { lang, setLang } = useI18n();
  return (
    <div
      className="inline-flex items-center rounded-lg p-0.5 border border-[#d8a74a]/60 bg-[#120c14]/85 shadow-inner"
      role="group"
      aria-label="Language selector"
    >
      <button
        type="button"
        onClick={() => setLang("ro")}
        className={`px-2.5 py-1 rounded-md text-xs font-cinzel font-bold tracking-wider transition-all cursor-pointer ${
          lang === "ro"
            ? "bg-gradient-to-b from-[#e8bf65] to-[#a97222] text-[#1a0f06] shadow"
            : "text-[#d5be90] hover:text-[#fff0c4]"
        }`}
      >
        {compact ? "RO" : "🇷🇴 RO"}
      </button>
      <button
        type="button"
        onClick={() => setLang("en")}
        className={`px-2.5 py-1 rounded-md text-xs font-cinzel font-bold tracking-wider transition-all cursor-pointer ${
          lang === "en"
            ? "bg-gradient-to-b from-[#e8bf65] to-[#a97222] text-[#1a0f06] shadow"
            : "text-[#d5be90] hover:text-[#fff0c4]"
        }`}
      >
        {compact ? "EN" : "🇬🇧 EN"}
      </button>
    </div>
  );
}
