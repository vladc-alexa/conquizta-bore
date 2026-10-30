"use client";

import { useEffect, useState, useCallback } from "react";
import TowerLobbyPanel from "@/components/TowerLobbyPanel";
import CarciumaLobbyPanel from "@/components/CarciumaLobbyPanel";
import GeneralChat from "@/components/GeneralChat";
import PlayersPanel from "@/components/PlayersPanel";
import Brand from "@/components/Brand";

type PanelKey = "tower" | "carciuma" | "train";

export default function Dashboard() {
  const [name, setName] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  // bumped after a rename / colour change so the chat card re-renders every bubble
  const [chatRefresh, setChatRefresh] = useState(0);
  const [mySiteOff, setMySiteOff] = useState(false);
  // which dashboard panels the player folded away (kept in localStorage)
  const [closedPanels, setClosedPanels] = useState<Record<PanelKey, boolean>>({ tower: false, carciuma: false, train: false });
  const setPanelClosed = useCallback((key: PanelKey, closed: boolean) => {
    setClosedPanels((prev) => {
      const next = { ...prev, [key]: closed };
      try {
        window.localStorage.setItem("bore.panels", JSON.stringify(next));
      } catch {
        /* private mode */
      }
      return next;
    });
  }, []);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("bore.panels");
      if (raw) setClosedPanels((prev) => ({ ...prev, ...JSON.parse(raw) }));
    } catch {
      /* ignore malformed storage */
    }
  }, []);

  // change-password modal
  const [showPw, setShowPw] = useState(false);
  const [curPw, setCurPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pwBusy, setPwBusy] = useState(false);

  // change-name modal
  const [showName, setShowName] = useState(false);
  const [newName, setNewName] = useState("");
  const [nameMsg, setNameMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [nameBusy, setNameBusy] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) {
          setName(d.name);
          setIsAdmin(!!d.isAdmin);
          setMySiteOff(!!d.siteOff);
        }
      })
      .catch(() => {});
  }, []);

  const rename = async (e: React.FormEvent) => {
    e.preventDefault();
    setNameMsg(null);
    setNameBusy(true);
    try {
      const res = await fetch("/api/auth/name", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNameMsg({ ok: false, text: data.error || "Eroare." });
        return;
      }
      setName(data.name);
      setNameMsg({ ok: true, text: "Numele a fost schimbat." });
      setShowName(false);
      setChatRefresh((n) => n + 1);
    } catch {
      setNameMsg({ ok: false, text: "Eroare de rețea." });
    } finally {
      setNameBusy(false);
    }
  };

  const toggleSite = async () => {
    const turningOff = !mySiteOff;
    if (!window.confirm(turningOff ? "Oprești site-ul? Doar adminii îl vor mai vedea." : "Porngi site-ul înapoi?")) return;
    try {
      const res = await fetch("/api/admin/site-off", { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        setMySiteOff(!!data.off);
      }
    } catch {
      /* ignore */
    }
  };

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = mySiteOff ? "/admin/login" : "/login";
  };

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwMsg(null);
    setPwBusy(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: curPw, newPassword: newPw }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPwMsg({ ok: false, text: data.error || "Eroare." });
        return;
      }
      setPwMsg({ ok: true, text: "Parola a fost schimbată." });
      setCurPw("");
      setNewPw("");
    } catch {
      setPwMsg({ ok: false, text: "Eroare de rețea." });
    } finally {
      setPwBusy(false);
    }
  };

  // Small screens: the nav has to wrap instead of shoving buttons off the left
  // edge (each one keeps a 40px-tall tap target).
  const navBtn =
    "font-cinzel text-[#8fb0ac] hover:text-[#9ec6c1] text-[0.75rem] sm:text-[0.8rem] " +
    "border border-[#1e3a34] rounded-lg px-2.5 sm:px-3.5 py-2 min-h-[40px] inline-flex items-center gap-1 bg-[#0c1a17] cursor-pointer";

  return (
    <div className="w-full max-w-[1380px] mx-auto flex flex-col gap-3 py-1">
      {/* Header: the wordmark rides in the same row as the buttons — it used to
          sit on its own row above them and pushed the dashboard past one
          screen, which is what forced a page scrollbar. */}
      <header className="flex flex-wrap items-center gap-2 sm:gap-3">
        <a
          href="/"
          className="shrink-0 leading-none hover:brightness-125 transition-[filter]"
          title="Pagina principală"
          aria-label="ST0NE QUIZ — pagina principală"
        >
          <Brand size={21} />
        </a>
        {/* Gluma zilei sits between the wordmark and the buttons, on the same
            row — it used to eat a whole card in the right rail. */}
        <div
          className="order-3 sm:order-none w-full sm:w-auto sm:flex-1 sm:max-w-[520px] min-w-0 sm:mx-2 rounded-lg border border-[#1e3a34] bg-[#0c1a17]/80 px-3 py-1.5 flex items-baseline gap-2"
          title="Gluma zilei"
        >
          <span className="shrink-0 text-[0.7rem] font-cinzel tracking-widest text-[#75938f]">😂 GLUMA ZILEI</span>
          <span className="min-w-0 truncate font-cinzel text-[0.82rem] text-[#cbdcda]">„Tu! Tu esti gluma!”</span>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
          <a href="/leaderboard" className={navBtn}>
            👑 Clasament
          </a>
          {isAdmin && (
            <a href="/admin" className={navBtn}>
              Admin
            </a>
          )}
          {name && (
            <button
              onClick={() => {
                setShowName(true);
                setNameMsg(null);
                setNewName(name);
              }}
              className={navBtn}
              title="Schimbă numele"
              aria-label="Schimbă numele"
            >
              ✏️
            </button>
          )}
          {name && (
            <button
              onClick={() => {
                setShowPw(true);
                setPwMsg(null);
                setCurPw("");
                setNewPw("");
              }}
              className={navBtn}
              title="Schimbă parola"
              aria-label="Schimbă parola"
            >
              🔑
            </button>
          )}
          {name && (
            <span className={`${navBtn} max-w-[9rem] cursor-default text-[#9ec6c1] tracking-wider`}>
              <span className="truncate">{name}</span>
            </span>
          )}
          {isAdmin && (
            <button
              onClick={toggleSite}
              className={`${navBtn} ${
                mySiteOff ? "text-green-400 border-green-500/50 hover:brightness-125" : "hover:text-red-400"
              }`}
              title={mySiteOff ? "Site oprit — pornește-l" : "Oprește site-ul (doar adminii îl mai văd)"}
              aria-label={mySiteOff ? "Pornește site-ul" : "Oprește site-ul"}
            >
              {mySiteOff ? (
                "▶"
              ) : (
                // inline SVG: the ⏻ glyph is a tofu box on Android fonts
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                  <path d="M12 3v9" />
                  <path d="M6.4 6.4a8 8 0 1 0 11.2 0" />
                </svg>
              )}
            </button>
          )}
          <button
            onClick={logout}
            className="bg-gradient-to-br from-[#2c514c] to-[#101f1c] border-2 border-[#4d7a76a0] rounded-lg text-[#e2eeeb] text-[0.75rem] sm:text-[0.8rem] font-cinzel px-3 sm:px-3.5 py-2 min-h-[40px] hover:brightness-125 cursor-pointer"
          >
            Ieșire
          </button>
        </div>
      </header>

      <div className="flex flex-col lg:flex-row gap-4 items-start">
        {/* Three lanes: chat | the three game boxes (half width, so the roster
            fits beside them) | who is online right now. */}
        <GeneralChat refreshToken={chatRefresh} />

        <div className="w-full lg:w-[392px] shrink-0 flex flex-col gap-3 lg:max-h-[calc(100vh-130px)] lg:overflow-y-auto lg:pb-1">
          {closedPanels.train ? (
            <button
              onClick={() => setPanelClosed("train", false)}
              className="w-full rounded-2xl border-2 border-dashed border-[#1e3a34] bg-[#0c1a17]/70 px-3 py-4 text-left text-[0.8rem] text-[#8fb0ac] hover:border-[#3f615c] hover:text-[#9ec6c1] cursor-pointer"
            >
              🏋️ Train e închis — <span className="underline">deschide-l</span>
            </button>
          ) : (
            <section className="shrink-0 overflow-hidden bg-gradient-to-br from-[#122420] to-[#0c1a17] border-2 border-[#1e3a34] rounded-2xl shadow-2xl w-full p-[1.15rem] flex flex-col gap-2.5">
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-cinzel text-[#9ec6c1] text-[0.9rem] tracking-widest">🏋️ Train</h3>
                <button
                  onClick={() => setPanelClosed("train", true)}
                  className="text-[#75938f] hover:text-[#9ec6c1] cursor-pointer text-[0.85rem]"
                  title="Închide"
                >
                  ✕
                </button>
              </div>
              <p className="text-[#8fb0ac] text-[0.8rem] leading-snug">
                90 de secunde, cât mai multe puncte. Mix de grilă și rapidă.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <a
                  href="/train"
                  className="flex-1 min-w-[140px] text-center bg-gradient-to-br from-[#8fd9a8] to-[#3f8f63] border-2 border-[#8fd9a880] rounded-lg text-[#08201a] font-cinzel text-[0.9rem] tracking-wider p-2.5 hover:brightness-110 active:translate-y-px"
                >
                  ▶ Pornește 90 de secunde
                </a>
                <a
                  href="/leaderboard?tab=train"
                  className="text-[0.75rem] text-[#8fb0ac] hover:text-[#9ec6c1] border border-[#1e3a34] rounded-lg bg-[#0c1a17] px-2.5 py-2"
                >
                  🏆 Rezultate
                </a>
              </div>
              <p className="mt-auto pt-1 text-[0.72rem] leading-relaxed text-[#5f7f7b]">
                2 grilă : 1 rapidă · punctele cresc cu viteza · cel mai bun run
                al tău intră în clasament
              </p>
            </section>
          )}

          {closedPanels.carciuma ? (
            <button
              onClick={() => setPanelClosed("carciuma", false)}
              className="w-full rounded-2xl border-2 border-dashed border-[#1e3a34] bg-[#0c1a17]/70 px-3 py-4 text-left text-[0.8rem] text-[#8fb0ac] hover:border-[#3f615c] hover:text-[#9ec6c1] cursor-pointer"
            >
              🍺 La Carciuma e închisă — <span className="underline">deschide-o</span>
            </button>
          ) : (
            <section className="shrink-0 overflow-hidden bg-gradient-to-br from-[#122420] to-[#0c1a17] border-2 border-[#1e3a34] rounded-2xl shadow-2xl w-full p-[1.15rem] flex flex-col gap-2.5">
              <CarciumaLobbyPanel onUnauthorized={() => { window.location.href = "/login"; }} onClose={() => setPanelClosed("carciuma", true)} />
            </section>
          )}

          {closedPanels.tower ? (
            <button
              onClick={() => setPanelClosed("tower", false)}
              className="w-full rounded-2xl border-2 border-dashed border-[#1e3a34] bg-[#0c1a17]/70 px-3 py-4 text-left text-[0.8rem] text-[#8fb0ac] hover:border-[#3f615c] hover:text-[#9ec6c1] cursor-pointer"
            >
              🏰 Turnul e închis — <span className="underline">deschide-l</span>
            </button>
          ) : (
            <section className="shrink-0 overflow-hidden bg-gradient-to-br from-[#122420] to-[#0c1a17] border-2 border-[#1e3a34] rounded-2xl shadow-2xl w-full p-[1.15rem] flex flex-col gap-2.5">
              <TowerLobbyPanel onUnauthorized={() => { window.location.href = "/login"; }} onClose={() => setPanelClosed("tower", true)} />
            </section>
          )}
        </div>

        {/* Who is online — back on the dashboard, beside the games. */}
        <section className="w-full lg:flex-1 lg:min-w-[260px] bg-gradient-to-br from-[#122420] to-[#0c1a17] border-2 border-[#1e3a34] rounded-2xl shadow-2xl p-[1.15rem] flex flex-col gap-2.5 lg:h-[calc(100vh-130px)] overflow-hidden">
          <PlayersPanel />
        </section>
      </div>

      {/* change-password modal */}
      {showPw && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <form
            onSubmit={changePassword}
            className="bg-gradient-to-br from-[#122420] to-[#0c1a17] border-2 border-[#1e3a34] rounded-2xl shadow-2xl w-full max-w-md p-[1.75rem] flex flex-col gap-3"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-cinzel text-[#9ec6c1] text-[0.9rem] tracking-widest">🔑 Schimbă parola</h3>
              <button type="button" onClick={() => setShowPw(false)} className="text-[#8fb0ac] hover:text-[#9ec6c1] cursor-pointer">
                ✕
              </button>
            </div>
            <input
              type="password"
              required
              value={curPw}
              onChange={(e) => setCurPw(e.target.value)}
              placeholder="Parola actuală"
              autoComplete="current-password"
              className="bg-[#050d0b] border-2 border-[#1e3a34] rounded-lg text-[#9ec6c1] p-[0.7rem] outline-none focus:border-[#6f9c99]"
            />
            <input
              type="password"
              required
              minLength={4}
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
              placeholder="Parola nouă (min 4)"
              autoComplete="new-password"
              className="bg-[#050d0b] border-2 border-[#1e3a34] rounded-lg text-[#9ec6c1] p-[0.7rem] outline-none focus:border-[#6f9c99]"
            />
            {pwMsg && (
              <div className={`text-[0.8rem] ${pwMsg.ok ? "text-green-400" : "text-red-400"}`}>{pwMsg.text}</div>
            )}
            <button
              type="submit"
              disabled={pwBusy}
              className="bg-gradient-to-br from-[#6f9c99] to-[#2c514c] border-2 border-[#9ec6c160] rounded-lg text-[#e2eeeb] font-cinzel p-[0.7rem] hover:brightness-110 disabled:opacity-50 cursor-pointer"
            >
              {pwBusy ? "Se salvează…" : "Salvează"}
            </button>
          </form>
        </div>
      )}

      {/* change-name modal */}
      {showName && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <form
            onSubmit={rename}
            className="bg-gradient-to-br from-[#122420] to-[#0c1a17] border-2 border-[#1e3a34] rounded-2xl shadow-2xl w-full max-w-sm p-6 flex flex-col gap-3"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-cinzel text-[#9ec6c1] text-[0.9rem] tracking-widest">✏️ Schimbă numele</h3>
              <button type="button" onClick={() => setShowName(false)} className="text-[#8fb0ac] hover:text-[#9ec6c1] cursor-pointer">
                ✕
              </button>
            </div>
            <input
              required
              maxLength={32}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Nume nou (max 32)"
              autoComplete="off"
              className="bg-[#050d0b] border-2 border-[#1e3a34] rounded-lg text-[#9ec6c1] p-[0.7rem] outline-none focus:border-[#6f9c99]"
            />
            {nameMsg && (
              <div className={`text-[0.8rem] ${nameMsg.ok ? "text-green-400" : "text-red-400"}`}>{nameMsg.text}</div>
            )}
            <button
              type="submit"
              disabled={nameBusy || !newName.trim()}
              className="bg-gradient-to-br from-[#6f9c99] to-[#2c514c] border-2 border-[#9ec6c160] rounded-lg text-[#e2eeeb] font-cinzel p-[0.7rem] hover:brightness-110 disabled:opacity-50 cursor-pointer"
            >
              {nameBusy ? "Se salvează…" : "Salvează"}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
