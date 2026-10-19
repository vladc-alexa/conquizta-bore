"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function DuelLobby() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  const [checking, setChecking] = useState(true);

  // If I already have a game waiting / running, go straight back into it.
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/duel", { cache: "no-store" });
        if (r.status === 401) {
          window.location.href = "/login";
          return;
        }
        if (r.ok) {
          const d = await r.json();
          if (d.duelId) {
            router.replace(`/duel/${d.duelId}`);
            return;
          }
        }
      } catch {
        /* fall through to the lobby */
      }
      setChecking(false);
    })();
  }, [router]);

  async function create() {
    setBusy(true);
    setErr("");
    try {
      const r = await fetch("/api/duel", { method: "POST" });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.duelId) {
        router.push(`/duel/${d.duelId}`);
        return;
      }
      setErr(d.error || "N-am putut crea meciul.");
    } catch {
      setErr("Eroare de rețea.");
    }
    setBusy(false);
  }

  function join() {
    const raw = code.trim();
    if (!raw) return;
    const m = raw.match(/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/);
    const id = m ? m[1] : raw;
    router.push(`/duel/${id}`);
  }

  return (
    <div className="w-full max-w-[560px] mx-auto flex flex-col gap-4">
      <a
        href="/"
        className="self-start text-[#8fb0ac] hover:text-[#9ec6c1] text-[0.85rem] font-cinzel border border-[#1e3a34] rounded-lg px-3 py-1.5 bg-[#0c1a17]"
      >
        ← Înapoi
      </a>

      <div className="bg-gradient-to-br from-[#122420] to-[#0c1a17] border-2 border-[#1e3a34] rounded-2xl shadow-2xl p-7 flex flex-col gap-5 text-center">
        <h2 className="font-cinzel text-[#9ec6c1] text-[1.4rem] tracking-widest">⚔️ 1 la 1</h2>
        <p className="text-[#cbdcda] text-[0.95rem] leading-relaxed">
          Meci în <strong className="text-[#9ec6c1]">10 runde</strong>: 6 grilă + 4 rapidă.
          <br />
          Cine câștigă mai multe runde, câștigă meciul.
        </p>

        <button
          onClick={create}
          disabled={busy || checking}
          className="bg-gradient-to-br from-[#9ec6c1] to-[#6f9c99] border-2 border-[#9ec6c180] rounded-xl text-[#0c1a17] font-cinzel text-[1.05rem] tracking-wider p-4 hover:brightness-110 active:translate-y-px disabled:opacity-60 cursor-pointer"
        >
          {busy ? "Se creează…" : "➕ Creează meci"}
        </button>

        <div className="flex items-center gap-3 text-[#75938f] text-[0.75rem]">
          <span className="flex-1 h-px bg-[#1e3a3460]" />
          SAU
          <span className="flex-1 h-px bg-[#1e3a3460]" />
        </div>

        <div className="flex gap-2">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && join()}
            placeholder="Lipeste codul / linkul meciului"
            className="flex-1 bg-[#050d0b] border-2 border-[#1e3a34] rounded-xl p-3.5 text-[0.9rem] text-[#d3e3e1] placeholder-[#25443f] focus:border-[#6f9c99] outline-none"
          />
          <button
            onClick={join}
            disabled={!code.trim()}
            className="bg-gradient-to-br from-[#6f9c99] to-[#2c514c] border-2 border-[#9ec6c160] rounded-xl text-[#e2eeeb] font-cinzel px-5 hover:brightness-110 disabled:opacity-50 cursor-pointer"
          >
            Intră
          </button>
        </div>

        {err && <div className="text-red-400 text-[0.85rem]">{err}</div>}
        {checking && <div className="text-[#75938f] text-[0.8rem]">Se verifică…</div>}
      </div>
    </div>
  );
}
