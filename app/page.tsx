"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { BLACK_CHAT_COLOR, BLACK_NAME_OUTLINE, CHAT_COLORS, DEFAULT_CHAT_COLOR } from "@/lib/chatColors";
import PromptText, { isArt } from "@/components/PromptText";
import DuelLobbyPanel from "@/components/DuelLobbyPanel";
import { normalizeMessage } from "@/lib/messageText";

interface ChatMessage {
  id: string;
  authorName: string;
  text: string;
  createdAt: string;
  authorColor: string;
  muted: boolean;
}

export default function Dashboard() {
  const [name, setName] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const lastChatAtRef = useRef<string | null>(null);
  const [chatInput, setChatInput] = useState("");
  const [sending, setSending] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const [myColor, setMyColor] = useState<string | null>(null);
  const [showColors, setShowColors] = useState(false);
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

  // full=true loads the last 100 messages and replaces state; full=false asks the API
  // only for messages newer than our cursor and appends those we don't already have.
  const loadChat = useCallback(async (full = false) => {
    try {
      const since = !full ? lastChatAtRef.current : null;
      const res = await fetch(since ? `/api/chat?since=${encodeURIComponent(since)}` : "/api/chat");
      if (!res.ok) return;
      const data = await res.json();
      const incoming: ChatMessage[] = data.messages ?? [];
      if (since) {
        setMessages((prev) => {
          const seen = new Set(prev.map((m) => m.id));
          const add = incoming.filter((m) => !seen.has(m.id));
          return add.length ? [...prev, ...add] : prev;
        });
      } else {
        setMessages(incoming);
      }
      const newest = incoming.length ? incoming[incoming.length - 1].createdAt : null;
      if (newest) lastChatAtRef.current = newest;
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
          setMySiteOff(!!d.siteOff);
        }
      })
      .catch(() => {});
    loadChat(true);
    // 5s delta poll; a full resync every 30s so deletions/renames by others still land.
    let tick = 0;
    const chatTimer = setInterval(() => {
      tick += 1;
      loadChat(tick % 6 === 0);
    }, 5000);
    return () => clearInterval(chatTimer);
  }, [loadChat]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = async () => {
    // normalize, not .trim(): trimming would shift row 1 of pasted ASCII art
    const text = normalizeMessage(chatInput);
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
        loadChat(true);
      }
    } finally {
      setSending(false);
    }
  };

  const deleteMessage = async (id: string) => {
    try {
      const res = await fetch(`/api/admin/chat/${id}`, { method: "DELETE" });
      if (res.ok) loadChat(true);
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
        loadChat(true);
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
      loadChat(true);
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

  return (
    <div className="w-full max-w-6xl mx-auto flex flex-col gap-4 py-4">
      {/* Header */}
      <header className="flex items-center justify-end gap-3">
        <div className="flex items-center gap-3">
          <a
            href="/leaderboard"
            className="font-cinzel text-[#8fb0ac] hover:text-[#9ec6c1] text-[0.8rem] border border-[#1e3a34] rounded-lg px-3.5 py-2 bg-[#0c1a17]"
          >
            👑 Clasament
          </a>
          {isAdmin && (
            <a
              href="/admin"
              className="font-cinzel text-[#8fb0ac] hover:text-[#9ec6c1] text-[0.8rem] border border-[#1e3a34] rounded-lg px-3.5 py-2 bg-[#0c1a17]"
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
              className="font-cinzel text-[#8fb0ac] hover:text-[#9ec6c1] text-[0.8rem] border border-[#1e3a34] rounded-lg px-3.5 py-2 bg-[#0c1a17] cursor-pointer"
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
              className="font-cinzel text-[#8fb0ac] hover:text-[#9ec6c1] text-[0.8rem] border border-[#1e3a34] rounded-lg px-3.5 py-2 bg-[#0c1a17] cursor-pointer"
              title="Schimbă parola"
            >
              🔑
            </button>
          )}
          {name && (
            <span className="font-cinzel text-[#9ec6c1] text-[0.85rem] tracking-wider border border-[#1e3a34] rounded-lg px-3.5 py-2 bg-[#0c1a17]">
              {name}
            </span>
          )}
          {isAdmin && (
            <button
              onClick={toggleSite}
              className={`font-cinzel text-[0.8rem] border rounded-lg px-3.5 py-2 bg-[#0c1a17] cursor-pointer ${
                mySiteOff ? "text-green-400 border-green-500/50 hover:brightness-125" : "text-[#8fb0ac] border-[#1e3a34] hover:text-red-400"
              }`}
              title={mySiteOff ? "Site oprit — pornește-l" : "Oprește site-ul (doar adminii îl mai văd)"}
            >
              {mySiteOff ? "▶" : "⏻"}
            </button>
          )}
          <button
            onClick={logout}
            className="bg-gradient-to-br from-[#2c514c] to-[#101f1c] border-2 border-[#4d7a76a0] rounded-lg text-[#e2eeeb] text-[0.8rem] font-cinzel px-3.5 py-2 hover:brightness-125 cursor-pointer"
          >
            Ieșire
          </button>
        </div>
      </header>

      <div className="flex flex-col lg:flex-row gap-4 items-start">
        {/* Left: Chat */}
        <section className="bg-gradient-to-br from-[#122420] to-[#0c1a17] border-2 border-[#1e3a34] rounded-2xl shadow-2xl w-full lg:w-[552px] shrink-0 flex flex-col h-[552px] lg:h-[calc(100vh-200px)] lg:min-h-[644px]">
          <div className="flex items-center justify-between px-[1.15rem] py-[0.7rem] border-b border-[#1e3a3460] relative">
            <h3 className="font-cinzel text-[#9ec6c1] text-[0.85rem] tracking-widest">Chat general</h3>
            <div className="flex items-center gap-2">
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
              <div className="absolute right-3 top-11 z-20 bg-[#0c1a17] border-2 border-[#1e3a34] rounded-xl p-[0.7rem] flex flex-col gap-1.5 shadow-2xl">
                <span className="text-[0.65rem] text-[#8fb0ac] uppercase tracking-wider">Culoarea numelui</span>
                <div className="grid grid-cols-5 gap-1.5">
                  {CHAT_COLORS.map((c) => (
                    <button
                      key={c.hex}
                      onClick={() => setColor(c.hex)}
                      title={c.name}
                      className={`w-8 h-8 rounded-full border-2 cursor-pointer hover:scale-110 transition-transform ${
                        myColor === c.hex ? "border-[#9ec6c1] scale-110" : "border-[#1e3a34]"
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
              <div className="text-[#75938f] text-[0.75rem] text-center p-4">Niciun mesaj încă. Spune salut!</div>
            ) : (
              messages.map((m) => (
                <div key={m.id} className="text-[0.9rem] leading-snug flex items-start gap-1 group">
                  {/* art gets its own block under the name: a <pre> starts on the
                      next line instead of visually splitting the first row off */}
                  <div className={`flex-1 min-w-0 ${isArt(m.text) ? "flex flex-col" : "flex items-start gap-1"}`}>
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
                    {m.muted && <span className="text-[#75938f] text-[0.65rem] ml-1" title="mutat">🔇</span>}
                    {isArt(m.text) ? ":" : ": "}
                    </span>
                    <span className="text-[#cbdcda] flex-1 min-w-0"><PromptText text={m.text} wrap /></span>
                  </div>
                  {isAdmin && (
                    <button
                      onClick={() => deleteMessage(m.id)}
                      className="text-[#75938f] opacity-0 group-hover:opacity-100 hover:text-red-400 text-[0.7rem] cursor-pointer"
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
          <div className="p-[0.7rem] border-t border-[#1e3a3460] flex gap-2">
            <textarea
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => {
                // Enter sends, Shift+Enter breaks the line (art needs real newlines)
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage();
                }
              }}
              placeholder="Mesaj… (Shift+Enter = linie nouă)"
              maxLength={2000}
              rows={Math.min(6, Math.max(1, chatInput.split("\n").length))}
              className="flex-1 resize-none bg-[#050d0b] border-2 border-[#1e3a34] rounded-lg text-[#9ec6c1] text-[0.85rem] p-[0.6rem] outline-none focus:border-[#6f9c99] font-mono"
            />
            <button
              onClick={sendMessage}
              disabled={sending || !chatInput.trim()}
              className="bg-gradient-to-br from-[#6f9c99] to-[#2c514c] border-2 border-[#9ec6c160] rounded-lg text-[#e2eeeb] px-3.5 hover:brightness-110 disabled:opacity-40 cursor-pointer"
              title="Trimite"
            >
              ➤
            </button>
          </div>
        </section>

        {/* Center: 1 la 1 lobby — create a match, others join it from here */}
        <section className="bg-gradient-to-br from-[#122420] to-[#0c1a17] border-2 border-[#1e3a34] rounded-2xl shadow-2xl w-full flex-1 p-[1.15rem] flex flex-col gap-2.5">
          <DuelLobbyPanel onUnauthorized={() => { window.location.href = "/login"; }} />
        </section>

        {/* Right rail */}
        <section className="w-full lg:w-[300px] shrink-0 flex flex-col gap-4">
          <a
            href="/train"
            className="bg-gradient-to-br from-[#9ec6c1] to-[#6f9c99] border-2 border-[#9ec6c180] rounded-2xl shadow-2xl text-center p-[1.45rem] hover:brightness-110 active:translate-y-px"
          >
            <div className="font-cinzel text-[#0c1a17] text-[1.1rem] tracking-widest">🏋️ Train</div>
            <div className="text-[#122420] text-[0.8rem] mt-1 font-bold">VREI SA TI-O MASORI?</div>
          </a>

          <a
            href="/tower"
            className="bg-gradient-to-br from-[#d9a441] to-[#8a6120] border-2 border-[#d9a44180] rounded-2xl shadow-2xl text-center p-[1.15rem] hover:brightness-110 active:translate-y-px"
          >
            <div className="font-cinzel text-[#0c1a17] text-[1rem] tracking-widest">🏰 Turnul</div>
            <div className="text-[#2a1d08] text-[0.75rem] mt-1 font-bold">8 JUCĂTORI · 9 RUNDE</div>
          </a>

          <div className="bg-gradient-to-br from-[#122420] to-[#0c1a17] border-2 border-[#1e3a34] rounded-2xl shadow-2xl p-[1.15rem] flex flex-col gap-2">
            <h3 className="font-cinzel text-[#9ec6c1] text-[0.85rem] tracking-widest">😂 Gluma zilei</h3>
            <p className="text-[#cbdcda] text-[0.9rem] leading-relaxed font-cinzel">„Tu! Tu esti gluma!”</p>
          </div>
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
