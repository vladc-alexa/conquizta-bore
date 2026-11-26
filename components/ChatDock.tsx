"use client";

// Mounts the general chat as a floating dock on the game screens only. The
// dashboard keeps the full chat card, so the dock hides itself on "/".
import { usePathname } from "next/navigation";
import GeneralChat from "@/components/GeneralChat";

const GAME_ROUTES = ["/train", "/duel", "/tower", "/carciuma"];

export default function ChatDock() {
  const pathname = usePathname() ?? "";
  const inGame = GAME_ROUTES.some((r) => pathname === r || pathname.startsWith(`${r}/`));
  if (!inGame) return null;
  return <GeneralChat variant="dock" />;
}
