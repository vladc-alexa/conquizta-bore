export type WeaponType = "sword" | "spear" | "hammer" | "daggers";

export interface FighterDef {
  id: string;
  name: string;
  titleEn: string;
  titleRo: string;
  portrait: string;
  weapon: WeaponType;
  specialName: string;
  primaryColor: string;
  secondaryColor: string;
  capeColor: string;
  glowColor: string;
  accentColor: string;
  stats: {
    hp: number;
    speed: number;
    power: number;
    reach: number;
  };
  rating: {
    atk: number; // 1-100 for UI bars
    spd: number;
    def: number;
  };
}

export const FIGHTERS: FighterDef[] = [
  {
    id: "valen",
    name: "Sir Valen",
    titleEn: "Crimson Knight",
    titleRo: "Cavalerul Purpuriu",
    portrait: "/art/avatar-knight.jpg",
    weapon: "sword",
    specialName: "IGNIS WAVE",
    primaryColor: "#b91c1c",
    secondaryColor: "#cbd5e1",
    capeColor: "#991b1b",
    glowColor: "#f97316",
    accentColor: "#facc15",
    stats: { hp: 100, speed: 5.4, power: 1.0, reach: 78 },
    rating: { atk: 82, spd: 76, def: 80 },
  },
  {
    id: "lyra",
    name: "Lady Lyra",
    titleEn: "Azure Valkyrie",
    titleRo: "Walkiria Azurie",
    portrait: "/art/fighter-valkyrie.jpg",
    weapon: "spear",
    specialName: "FROST LANCE",
    primaryColor: "#1d4ed8",
    secondaryColor: "#e2e8f0",
    capeColor: "#1e40af",
    glowColor: "#38bdf8",
    accentColor: "#bae6fd",
    stats: { hp: 94, speed: 6.1, power: 0.96, reach: 90 },
    rating: { atk: 78, spd: 90, def: 74 },
  },
  {
    id: "brutus",
    name: "Brutus Ironjaw",
    titleEn: "Golden Paladin",
    titleRo: "Paladinul de Aur",
    portrait: "/art/fighter-paladin.jpg",
    weapon: "hammer",
    specialName: "SUN SMASH",
    primaryColor: "#b45309",
    secondaryColor: "#fde68a",
    capeColor: "#78350f",
    glowColor: "#facc15",
    accentColor: "#fef08a",
    stats: { hp: 115, speed: 4.5, power: 1.18, reach: 84 },
    rating: { atk: 95, spd: 58, def: 96 },
  },
  {
    id: "vex",
    name: "Shade Vex",
    titleEn: "Shadow Rogue",
    titleRo: "Umbra Nopții",
    portrait: "/art/fighter-rogue.jpg",
    weapon: "daggers",
    specialName: "VOID SLASH",
    primaryColor: "#6d28d9",
    secondaryColor: "#94a3b8",
    capeColor: "#3b0764",
    glowColor: "#c084fc",
    accentColor: "#e879f9",
    stats: { hp: 88, speed: 6.8, power: 0.92, reach: 68 },
    rating: { atk: 80, spd: 98, def: 64 },
  },
];

import { stoneSound } from "@/lib/sound";

// Unified realistic Foley & Convolution Reverb audio for Quiz Fighter
export const arcadeAudio = {
  get enabled() {
    return stoneSound.enabled;
  },
  set enabled(v: boolean) {
    stoneSound.enabled = v;
  },
  slash: () => stoneSound.slash(),
  lightHit: () => stoneSound.lightHit(),
  heavyHit: () => stoneSound.heavyHit(),
  block: () => stoneSound.block(),
  special: () => stoneSound.special(),
  jump: () => stoneSound.slash(),
  bell: () => stoneSound.bell(),
  ko: () => stoneSound.ko(),
};
