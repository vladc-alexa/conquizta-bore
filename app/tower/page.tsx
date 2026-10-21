"use client";

// /tower — the tower lobby + the rules of the siege.
import { useRouter } from "next/navigation";
import TowerLobbyPanel from "@/components/TowerLobbyPanel";

const RULES = [
  ["8 jucători, runde până la vârf", "Locurile libere sunt luate de boți — poți urca și singur."],
  ["Fiecare răspuns are punctaj", "Corect și rapid = până la 100 de puncte; greșit = 0."],
  ["Cine punctează mai mult urcă mai mult", "Punctajul rundei devine trepte: cel mai bun urcă 4, restul proporțional."],
  ["Din runda 2 cade ultimul", "La finalul fiecărei runde, jucătorul cu cel mai mic total se prăbușește de pe scară."],
  ["Cine ajunge primul sus câștigă", "Nu sunt runde fixe: turnul are 36 de trepte și meciul ține până le urcă cineva."],
];

export default function TowerLobbyPage() {
  const router = useRouter();
  return (
    <div className="w-full max-w-4xl flex flex-col gap-4 py-2">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="font-cinzel text-[#9ec6c1] text-[1.3rem] tracking-widest">🏰 TURNUL</h1>
          <p className="text-[#75938f] text-[0.75rem]">Asediul pe scări — 8 jucători, 36 de trepte, un singur cuceritor.</p>
        </div>
        <a
          href="/"
          className="font-cinzel text-[#8fb0ac] hover:text-[#9ec6c1] text-[0.78rem] border border-[#1e3a34] rounded-lg px-3 py-1.5 bg-[#0c1a17]"
        >
          ← Acasă
        </a>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
        <div className="bg-gradient-to-br from-[#122420] to-[#0c1a17] border-2 border-[#1e3a34] rounded-2xl p-4">
          <TowerLobbyPanel onUnauthorized={() => router.replace("/login")} />
        </div>

        <div className="bg-gradient-to-br from-[#122420] to-[#0c1a17] border-2 border-[#1e3a34] rounded-2xl p-4 flex flex-col gap-2.5">
          <h2 className="font-cinzel text-[#9ec6c1] text-[0.9rem] tracking-widest">Cum se joacă</h2>
          {RULES.map(([title, body]) => (
            <div key={title} className="border-l-2 border-[#4d7a76] pl-3">
              <div className="text-[#cbdcda] text-[0.85rem]">{title}</div>
              <div className="text-[#75938f] text-[0.75rem] leading-snug">{body}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
