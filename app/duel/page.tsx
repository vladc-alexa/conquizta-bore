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
        className="self-start text-[#c8a070] hover:text-[#f5c97a] text-[0.85rem] font-cinzel border border-[#7a4e22] rounded-lg px-3 py-1.5 bg-[#2a1608]"
      >
        ← Înapoi
      </a>

      <div className="bg-gradient-to-br from-[#3d2510] to-[#2a1608] border-2 border-[#7a4e22] rounded-2xl shadow-2xl p-7 flex flex-col gap-5 text-center">
        <h2 className="font-cinzel text-[#f5c97a] text-[1.4rem] tracking-widest">⚔️ 1 la 1</h2>
        <p className="text-[#e8d8b0] text-[0.95rem] leading-relaxed">
          Meci în <strong className="text-[#f5c97a]">10 runde</strong>: 6 grilă + 4 rapidă.
          <br />
          Cine câștigă mai multe runde, câștigă meciul.
        </p>

        <button
          onClick={create}
          disabled={busy || checking}
          className="bg-gradient-to-br from-[#f5c97a] to-[#c87030] border-2 border-[#f5c97a80] rounded-xl text-[#2a1608] font-cinzel text-[1.05rem] tracking-wider p-4 hover:brightness-110 active:translate-y-px disabled:opacity-60 cursor-pointer"
        >
          {busy ? "Se creează…" : "➕ Creează meci"}
        </button>

        <div className="flex items-center gap-3 text-[#a07848] text-[0.75rem]">
          <span className="flex-1 h-px bg-[#7a4e2260]" />
          SAU
          <span className="flex-1 h-px bg-[#7a4e2260]" />
        </div>

        <div className="flex gap-2">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && join()}
            placeholder="Lipeste codul / linkul meciului"
            className="flex-1 bg-[#1a0e05] border-2 border-[#7a4e22] rounded-xl p-3.5 text-[0.9rem] text-[#f0e0c0] placeholder-[#7a5a30] focus:border-[#c87030] outline-none"
          />
          <button
            onClick={join}
            disabled={!code.trim()}
            className="bg-gradient-to-br from-[#c87030] to-[#7a4010] border-2 border-[#f5c97a60] rounded-xl text-[#f5e8c0] font-cinzel px-5 hover:brightness-110 disabled:opacity-50 cursor-pointer"
          >
            Intră
          </button>
        </div>

        {err && <div className="text-red-400 text-[0.85rem]">{err}</div>}
        {checking && <div className="text-[#a07848] text-[0.8rem]">Se verifică…</div>}
      </div>
    </div>
  );
}
