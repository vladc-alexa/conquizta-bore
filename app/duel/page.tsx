"use client";

// Kept as a standalone page for direct links / post-match "Încă un meci".
// The real lobby now lives on the dashboard: create a match, and every open
// match is listed there with a Join button — no codes or links to copy.
import DuelLobbyPanel from "@/components/DuelLobbyPanel";

export default function DuelLobby() {
  return (
    <div className="w-full max-w-[560px] mx-auto flex flex-col gap-4">
      <a
        href="/"
        className="self-start text-[#8fb0ac] hover:text-[#9ec6c1] text-[0.85rem] font-cinzel border border-[#1e3a34] rounded-lg px-3 py-1.5 bg-[#0c1a17]"
      >
        ← Înapoi
      </a>

      <div className="bg-gradient-to-br from-[#122420] to-[#0c1a17] border-2 border-[#1e3a34] rounded-2xl shadow-2xl p-6 flex flex-col gap-4">
        <p className="text-[#cbdcda] text-[0.9rem] leading-relaxed text-center">
          Meci în <strong className="text-[#9ec6c1]">10 runde</strong>: 6 grilă + 4 rapidă.
          <br />
          Cine câștigă mai multe runde, câștigă meciul.
        </p>
        <DuelLobbyPanel onUnauthorized={() => { window.location.href = "/login"; }} />
      </div>
    </div>
  );
}
