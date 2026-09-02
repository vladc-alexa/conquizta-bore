"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { BLACK_CHAT_COLOR, BLACK_NAME_OUTLINE, CHAT_COLORS, DEFAULT_CHAT_COLOR } from "@/lib/chatColors";

interface ChatMessage {
  id: string;
  authorName: string;
  text: string;
  createdAt: string;
  authorColor: string;
  muted: boolean;
}

interface LeaderRow {
  id: string;
  name: string;
  prc: number | null;
  grila: number | null;
  rapide: number | null;
  games: number;
  hidden?: boolean;
}

export default function Dashboard() {
  const [name, setName] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [rows, setRows] = useState<LeaderRow[]>([]);
  const [meRow, setMeRow] = useState<LeaderRow | null>(null);
  const [sending, setSending] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const [myColor, setMyColor] = useState<string | null>(null);
  const [showColors, setShowColors] = useState(false);
  const [myScoreHidden, setMyScoreHidden] = useState(false);
  const [mySiteOff, setMySiteOff] = useState(false);

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

  const loadLeaderboard = useCallback(async () => {
    try {
      const res = await fetch("/api/leaderboard");
      if (!res.ok) return;
      const data = await res.json();
      setRows(data.rows ?? []);
      setMeRow(data.me ?? null);
    } catch {
      /* ignore */
    }
  }, []);

  const loadChat = useCallback(async () => {
    try {
      const res = await fetch("/api/chat");
      if (!res.ok) return;
      const data = await res.json();
      setMessages(data.messages ?? []);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) {
          setName(d.name);
          setIsAdmin(!!d.isAdmin);
          setMyColor(d.nameColor ?? DEFAULT_CHAT_COLOR);
          setMyScoreHidden(!!d.hideScore);
          setMySiteOff(!!d.siteOff);
        }
      })
      .catch(() => {});
    loadChat();
    loadLeaderboard();
    const chatTimer = setInterval(loadChat, 5000);
    return () => clearInterval(chatTimer);
  }, [loadChat, loadLeaderboard]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = async () => {
    const text = chatInput.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (res.ok) {
        setChatInput("");
        loadChat();
      }
    } finally {
      setSending(false);
    }
  };

  const deleteMessage = async (id: string) => {
    try {
      const res = await fetch(`/api/admin/chat/${id}`, { method: "DELETE" });
      if (res.ok) loadChat();
    } catch {
      /* ignore */
    }
  };

  const setColor = async (hex: string) => {
    try {
      const res = await fetch("/api/auth/color", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ color: hex }),
      });
      if (res.ok) {
        setMyColor(hex);
        setShowColors(false);
        loadChat();
      }
    } catch {
      /* ignore */
    }
  };

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
      loadChat();
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

  const toggleMyScore = async () => {
    try {
      const res = await fetch("/api/auth/hide-score", { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        setMyScoreHidden(!!data.hideScore);
        loadLeaderboard();
      }
    } catch {
      /* ignore */
    }
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

  return (
    <div className="w-full max-w-6xl mx-auto flex flex-col gap-4 py-4">
      {/* Header */}
      <header className="flex items-center justify-between gap-3">
        <h1 className="!mb-0 text-[1.3rem]">MAHALADOR</h1>
        <div className="flex items-center gap-3">
          {isAdmin && (
            <a
              href="/admin"
              className="font-cinzel text-[#c8a070] hover:text-[#f5c97a] text-[0.8rem] border border-[#7a4e22] rounded-lg px-3.5 py-2 bg-[#2a1608]"
            >
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
              className="font-cinzel text-[#c8a070] hover:text-[#f5c97a] text-[0.8rem] border border-[#7a4e22] rounded-lg px-3.5 py-2 bg-[#2a1608] cursor-pointer"
              title="Schimbă numele"
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
              className="font-cinzel text-[#c8a070] hover:text-[#f5c97a] text-[0.8rem] border border-[#7a4e22] rounded-lg px-3.5 py-2 bg-[#2a1608] cursor-pointer"
              title="Schimbă parola"
            >
              🔑
            </button>
          )}
          {name && (
            <span className="font-cinzel text-[#f5c97a] text-[0.85rem] tracking-wider border border-[#7a4e22] rounded-lg px-3.5 py-2 bg-[#2a1608]">
              {name}
            </span>
          )}
          {isAdmin && (
            <button
              onClick={toggleSite}
              className={`font-cinzel text-[0.8rem] border rounded-lg px-3.5 py-2 bg-[#2a1608] cursor-pointer ${
                mySiteOff ? "text-green-400 border-green-500/50 hover:brightness-125" : "text-[#c8a070] border-[#7a4e22] hover:text-red-400"
              }`}
              title={mySiteOff ? "Site oprit — pornește-l" : "Oprește site-ul (doar adminii îl mai văd)"}
            >
              {mySiteOff ? "▶" : "⏻"}
            </button>
          )}
          <button
            onClick={logout}
            className="bg-gradient-to-br from-[#7a4010] to-[#3d2010] border-2 border-[#c88040a0] rounded-lg text-[#f5e8c0] text-[0.8rem] font-cinzel px-3.5 py-2 hover:brightness-125 cursor-pointer"
          >
            Ieșire
          </button>
        </div>
      </header>

      <div className="flex flex-col lg:flex-row gap-4 items-start">
        {/* Left: Chat */}
        <section className="bg-gradient-to-br from-[#3d2510] to-[#2a1608] border-2 border-[#7a4e22] rounded-2xl shadow-2xl w-full lg:w-[552px] shrink-0 flex flex-col h-[552px] lg:h-[calc(100vh-200px)] lg:min-h-[644px]">
          <div className="flex items-center justify-between px-[1.15rem] py-[0.7rem] border-b border-[#7a4e2260] relative">
            <h3 className="font-cinzel text-[#f5c97a] text-[0.85rem] tracking-widest">Chat general</h3>
            <div className="flex items-center gap-2">
              <span className="text-[#a07848] text-[0.7rem]">{messages.length} mesaje</span>
              {name && (
                <button
                  onClick={() => setShowColors((v) => !v)}
                  className="text-[0.9rem] cursor-pointer hover:scale-110 transition-transform"
                  title="Culoarea numelui tău"
                >
                  🎨
                </button>
              )}
            </div>
            {showColors && (
              <div className="absolute right-3 top-11 z-20 bg-[#2a1608] border-2 border-[#7a4e22] rounded-xl p-[0.7rem] flex flex-col gap-1.5 shadow-2xl">
                <span className="text-[0.65rem] text-[#c8a070] uppercase tracking-wider">Culoarea numelui</span>
                <div className="grid grid-cols-5 gap-1.5">
                  {CHAT_COLORS.map((c) => (
                    <button
                      key={c.hex}
                      onClick={() => setColor(c.hex)}
                      title={c.name}
                      className={`w-8 h-8 rounded-full border-2 cursor-pointer hover:scale-110 transition-transform ${
                        myColor === c.hex ? "border-[#f5c97a] scale-110" : "border-[#7a4e22]"
                      }`}
                      style={{
                        backgroundColor: c.hex,
                        ...(c.hex === BLACK_CHAT_COLOR && { boxShadow: `inset 0 0 0 2px ${BLACK_NAME_OUTLINE}` }),
                      }}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="flex-1 overflow-y-auto p-3.5 flex flex-col gap-1.5">
            {messages.length === 0 ? (
              <div className="text-[#a07848] text-[0.75rem] text-center p-4">Niciun mesaj încă. Spune salut!</div>
            ) : (
              messages.map((m) => (
                <div key={m.id} className="text-[0.9rem] leading-snug flex items-start gap-1 group">
                  <span
                    className="font-cinzel"
                    style={{
                      color: m.authorColor,
                      textShadow:
                        m.authorColor === BLACK_CHAT_COLOR
                          ? `-1.5px -1.5px 0 ${BLACK_NAME_OUTLINE}, 1.5px -1.5px 0 ${BLACK_NAME_OUTLINE}, -1.5px 1.5px 0 ${BLACK_NAME_OUTLINE}, 1.5px 1.5px 0 ${BLACK_NAME_OUTLINE}, 0 -1.5px 0 ${BLACK_NAME_OUTLINE}, 0 1.5px 0 ${BLACK_NAME_OUTLINE}, -1.5px 0 0 ${BLACK_NAME_OUTLINE}, 1.5px 0 0 ${BLACK_NAME_OUTLINE}, 0 0 8px rgba(181,126,220,0.7)`
                          : "0 1px 2px rgba(0,0,0,0.9)",
                    }}
                  >
                    {m.authorName}
                    {m.muted && <span className="text-[#a07848] text-[0.65rem] ml-1" title="mutat">🔇</span>}
                    {": "}
                  </span>
                  <span className="text-[#e8d8b0] flex-1">{m.text}</span>
                  {isAdmin && (
                    <button
                      onClick={() => deleteMessage(m.id)}
                      className="text-[#a07848] opacity-0 group-hover:opacity-100 hover:text-red-400 text-[0.7rem] cursor-pointer"
                      title="Șterge mesajul"
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))
            )}
            <div ref={chatEndRef} />
          </div>
          <div className="p-[0.7rem] border-t border-[#7a4e2260] flex gap-2">
            <input
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendMessage()}
              placeholder="Mesaj…"
              maxLength={500}
              className="flex-1 bg-[#1a0e05] border-2 border-[#7a4e22] rounded-lg text-[#f5c97a] text-[0.85rem] p-[0.6rem] outline-none focus:border-[#c87030]"
            />
            <button
              onClick={sendMessage}
              disabled={sending || !chatInput.trim()}
              className="bg-gradient-to-br from-[#c87030] to-[#7a4010] border-2 border-[#f5c97a60] rounded-lg text-[#f5e8c0] px-3.5 hover:brightness-110 disabled:opacity-40 cursor-pointer"
              title="Trimite"
            >
              ➤
            </button>
          </div>
        </section>

        {/* Center: Leaderboard */}
        <section className="bg-gradient-to-br from-[#3d2510] to-[#2a1608] border-2 border-[#7a4e22] rounded-2xl shadow-2xl w-full flex-1 p-[1.15rem] flex flex-col gap-2.5">
          <div className="flex items-center justify-between">
            <h3 className="font-cinzel text-[#f5c97a] text-[0.9rem] tracking-widest">👑 Clasamentul zilei</h3>
            <div className="flex items-center gap-2">
              {name && (
                <button
                  onClick={toggleMyScore}
                  className={`text-[0.7rem] border rounded-lg px-2 py-1 cursor-pointer hover:brightness-110 ${
                    myScoreHidden
                      ? "text-[#b57edc] border-purple-500/40 bg-purple-900/20"
                      : "text-[#c8a070] border-[#7a4e22] hover:bg-[#3d2510]"
                  }`}
                  title={myScoreHidden ? "Scorul tău e ascuns public — arată-l" : "Ascunde scorul tău de pe clasamentul public"}
                >
                  {myScoreHidden ? "🔒 Scor ascuns" : "🔒 Ascunde scorul"}
                </button>
              )}
              <button
                onClick={loadLeaderboard}
                className="text-[#c8a070] hover:text-[#f5c97a] text-[0.75rem] cursor-pointer"
                title="Reîmprospătează"
              >
                ⟳
              </button>
            </div>
          </div>
          {rows.length === 0 ? (
            <div className="text-[#a07848] text-[0.8rem] text-center p-6">Niciun jucător cu PRC încă. Antrenează-te!</div>
          ) : (
            <div className="flex flex-col">
              {rows.map((r, i) => (
                <div
                  key={r.id + i}
                  className="grid grid-cols-[24px_1fr_auto] gap-2 text-[0.82rem] p-1.5 px-2 rounded items-center odd:bg-white/5"
                >
                  <span className="text-[#a07848] text-[0.75rem]">{i + 1}</span>
                  <span className="min-w-0">
                    <span className="font-cinzel truncate block text-[#e8d8b0]">{r.name}</span>
                    <span className="text-[0.65rem] text-[#a07848] block">
                      {r.grila !== null && <>grilă {r.grila}</>}
                      {r.grila !== null && r.rapide !== null && " · "}
                      {r.rapide !== null && <>rapide {r.rapide}</>}
                    </span>
                  </span>
                  <span className="font-cinzel text-[#f5c97a] font-bold text-[1rem]">
                    {r.prc != null ? r.prc.toLocaleString("ro-RO") : "—"}
                  </span>
                </div>
              ))}
              {meRow && !rows.some((r) => r.id === meRow.id) && (
                <>
                  <div className="border-t border-[#7a4e2260] my-1" />
                  <div className="grid grid-cols-[24px_1fr_auto] gap-2 text-[0.82rem] p-1.5 px-2 rounded items-center bg-[#c8703026] border border-[#c87030a0]">
                    <span className="text-[#a07848] text-[0.75rem]">{rows.length + 1}</span>
                    <span className="min-w-0">
                      <span className="font-cinzel truncate block text-[#f5c97a]">
                        {meRow.name} (tu)
                        {meRow.hidden && (
                          <span className="text-[0.65rem] text-[#b57edc] ml-1.5" title="Scorul tău e ascuns public">🔒</span>
                        )}
                      </span>
                      <span className="text-[0.65rem] text-[#a07848] block">
                        {meRow.grila !== null && <>grilă {meRow.grila}</>}
                        {meRow.grila !== null && meRow.rapide !== null && " · "}
                        {meRow.rapide !== null && <>rapide {meRow.rapide}</>}
                      </span>
                    </span>
                    <span className="font-cinzel text-[#f5c97a] font-bold text-[1rem]">
                      {meRow.prc != null ? meRow.prc.toLocaleString("ro-RO") : "—"}
                    </span>
                  </div>
                </>
              )}
            </div>
          )}
        </section>

        {/* Right rail */}
        <section className="w-full lg:w-[300px] shrink-0 flex flex-col gap-4">
          <a
            href="/train"
            className="bg-gradient-to-br from-[#f5c97a] to-[#c87030] border-2 border-[#f5c97a80] rounded-2xl shadow-2xl text-center p-[1.45rem] hover:brightness-110 active:translate-y-px"
          >
            <div className="font-cinzel text-[#2a1608] text-[1.1rem] tracking-widest">🏋️ Train</div>
            <div className="text-[#3d2510] text-[0.8rem] mt-1 font-bold">VREI SA TI-O MASORI?</div>
          </a>

          <div className="bg-gradient-to-br from-[#3d2510] to-[#2a1608] border-2 border-[#7a4e22] rounded-2xl shadow-2xl p-[1.15rem] flex flex-col gap-2">
            <h3 className="font-cinzel text-[#f5c97a] text-[0.85rem] tracking-widest">😂 Gluma zilei</h3>
            <p className="text-[#e8d8b0] text-[0.9rem] leading-relaxed font-cinzel">„Tu! Tu esti gluma!”</p>
          </div>
        </section>
      </div>

      {/* change-password modal */}
      {showPw && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <form
            onSubmit={changePassword}
            className="bg-gradient-to-br from-[#3d2510] to-[#2a1608] border-2 border-[#7a4e22] rounded-2xl shadow-2xl w-full max-w-md p-[1.75rem] flex flex-col gap-3"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-cinzel text-[#f5c97a] text-[0.9rem] tracking-widest">🔑 Schimbă parola</h3>
              <button type="button" onClick={() => setShowPw(false)} className="text-[#c8a070] hover:text-[#f5c97a] cursor-pointer">
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
              className="bg-[#1a0e05] border-2 border-[#7a4e22] rounded-lg text-[#f5c97a] p-[0.7rem] outline-none focus:border-[#c87030]"
            />
            <input
              type="password"
              required
              minLength={4}
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
              placeholder="Parola nouă (min 4)"
              autoComplete="new-password"
              className="bg-[#1a0e05] border-2 border-[#7a4e22] rounded-lg text-[#f5c97a] p-[0.7rem] outline-none focus:border-[#c87030]"
            />
            {pwMsg && (
              <div className={`text-[0.8rem] ${pwMsg.ok ? "text-green-400" : "text-red-400"}`}>{pwMsg.text}</div>
            )}
            <button
              type="submit"
              disabled={pwBusy}
              className="bg-gradient-to-br from-[#c87030] to-[#7a4010] border-2 border-[#f5c97a60] rounded-lg text-[#f5e8c0] font-cinzel p-[0.7rem] hover:brightness-110 disabled:opacity-50 cursor-pointer"
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
            className="bg-gradient-to-br from-[#3d2510] to-[#2a1608] border-2 border-[#7a4e22] rounded-2xl shadow-2xl w-full max-w-sm p-6 flex flex-col gap-3"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-cinzel text-[#f5c97a] text-[0.9rem] tracking-widest">✏️ Schimbă numele</h3>
              <button type="button" onClick={() => setShowName(false)} className="text-[#c8a070] hover:text-[#f5c97a] cursor-pointer">
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
              className="bg-[#1a0e05] border-2 border-[#7a4e22] rounded-lg text-[#f5c97a] p-[0.7rem] outline-none focus:border-[#c87030]"
            />
            {nameMsg && (
              <div className={`text-[0.8rem] ${nameMsg.ok ? "text-green-400" : "text-red-400"}`}>{nameMsg.text}</div>
            )}
            <button
              type="submit"
              disabled={nameBusy || !newName.trim()}
              className="bg-gradient-to-br from-[#c87030] to-[#7a4010] border-2 border-[#f5c97a60] rounded-lg text-[#f5e8c0] font-cinzel p-[0.7rem] hover:brightness-110 disabled:opacity-50 cursor-pointer"
            >
              {nameBusy ? "Se salvează…" : "Salvează"}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
