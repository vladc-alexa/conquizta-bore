"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";

export type ArtTheme = "stone" | "scifi";

const STORAGE_KEY = "stone_quiz_art_theme";

interface ThemeContextValue {
  theme: ArtTheme;
  setTheme: (t: ArtTheme) => void;
  art: {
    avatar: string;
    cardDuel: string;
    cardSiege: string;
    cardTurnul: string;
    cardPrc: string;
    cardTrain: string;
    cardCrown: string;
    cardBanners: string;
    fightStage: string;
    siegeEnv: string;
  };
}

const ART_MAP: Record<ArtTheme, ThemeContextValue["art"]> = {
  stone: {
    avatar: "/art/avatar-knight.jpg",
    cardDuel: "/art/card-duel.jpg",
    cardSiege: "/art/card-siege.jpg",
    cardTurnul: "/art/card-crown.jpg",
    cardPrc: "/art/card-map.jpg",
    cardTrain: "/art/card-train.jpg",
    cardCrown: "/art/card-crown.jpg",
    cardBanners: "/art/card-banners.jpg",
    fightStage: "/art/bg-arena-fight.jpg",
    siegeEnv: "/art/siege-env.jpg",
  },
  scifi: {
    avatar: "/art/scifi/avatar-hero.jpg",
    cardDuel: "/art/scifi/card-duel.jpg",
    cardSiege: "/art/scifi/card-siege.jpg",
    cardTurnul: "/art/scifi/card-turnul.jpg",
    cardPrc: "/art/scifi/card-prc.jpg",
    cardTrain: "/art/scifi/card-train.jpg",
    cardCrown: "/art/scifi/card-turnul.jpg",
    cardBanners: "/art/scifi/card-siege.jpg",
    fightStage: "/art/scifi/bg-arena-fight.jpg",
    siegeEnv: "/art/scifi/siege-env.jpg",
  },
};

const ThemeContext = createContext<ThemeContextValue>({
  theme: "stone",
  setTheme: () => {},
  art: ART_MAP.stone,
});

export function ArtThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ArtTheme>("stone");

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === "stone" || saved === "scifi") {
        setThemeState(saved);
        document.documentElement.dataset.theme = saved;
      } else {
        document.documentElement.dataset.theme = "stone";
      }
    } catch {
      /* ignore */
    }
  }, []);

  const setTheme = (next: ArtTheme) => {
    setThemeState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
      document.documentElement.dataset.theme = next;
    } catch {
      /* ignore */
    }
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme, art: ART_MAP[theme] }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useArtTheme() {
  return useContext(ThemeContext);
}

export function ThemeSwitcher({ compact = false }: { compact?: boolean }) {
  const { theme, setTheme } = useArtTheme();
  const { lang } = useI18n();
  return (
    <div
      className="inline-flex items-center rounded-lg p-0.5 border border-[#d8a74a]/60 bg-[#120c14]/85 shadow-inner"
      role="group"
      aria-label="Art theme selector"
    >
      <button
        type="button"
        onClick={() => setTheme("stone")}
        className={`px-2.5 py-1 rounded-md text-xs font-cinzel font-bold tracking-wider transition-all cursor-pointer ${
          theme === "stone"
            ? "bg-gradient-to-b from-[#e8bf65] to-[#a97222] text-[#1a0f06] shadow"
            : "text-[#d5be90] hover:text-[#fff0c4]"
        }`}
      >
        {compact ? "🪨" : lang === "ro" ? "🪨 Piatră" : "🪨 Stone"}
      </button>
      <button
        type="button"
        onClick={() => setTheme("scifi")}
        className={`px-2.5 py-1 rounded-md text-xs font-cinzel font-bold tracking-wider transition-all cursor-pointer ${
          theme === "scifi"
            ? "bg-gradient-to-b from-[#38bdf8] to-[#0284c7] text-[#05121f] shadow"
            : "text-[#d5be90] hover:text-[#fff0c4]"
        }`}
      >
        {compact ? "🚀" : "🚀 Sci-Fi"}
      </button>
    </div>
  );
}
