// The "Negru" chat color: pure black, rendered with a purple text outline so it stays visible on the dark chat background.
export const BLACK_CHAT_COLOR = "#000000";

// Allowed chat name colors (shared by the API whitelist and the picker UI).
export const CHAT_COLORS: { name: string; hex: string }[] = [
  { name: "Roșu", hex: "#e74c3c" },
  { name: "Galben", hex: "#f5c97a" },
  { name: "Verde", hex: "#2ecc71" },
  { name: "Albastru", hex: "#5dade2" },
  { name: "Portocaliu", hex: "#e67e22" },
  { name: "Mov", hex: "#af7ac5" },
  { name: "Roz", hex: "#f1948a" },
  { name: "Turcoaz", hex: "#48c9b0" },
  { name: "Alb", hex: "#f0e0c0" },
  { name: "Negru", hex: BLACK_CHAT_COLOR },
];

export const ALLOWED_CHAT_COLORS = new Set(CHAT_COLORS.map((c) => c.hex));

export const DEFAULT_CHAT_COLOR = "#c87030";
