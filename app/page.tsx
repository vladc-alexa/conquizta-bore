"use client";

import { useEffect, useRef, useState, useCallback } from "react";

interface ChatMessage {
  id: string;
  authorName: string;
  text: string;
  createdAt: string;
}

interface LeaderRow {
  id: string;
  name: string;
  prc: number | null;
  grila: number | null;
  rapide: number | null;
  games: number;
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

  // change-password modal
  const [showPw, setShowPw] = useState(false);
  const [curPw, setCurPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pwBusy, setPwBusy] = useState(false);

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

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
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
              className="font-cinzel text-[#c8a070] hover:text-[#f5c97a] text-[0.8rem] border border-[#7a4e22] rounded-lg px-3 py-1.5 bg-[#2a1608]"
            >
              Admin
            </a>
          )}
          {name && (
            <button
              onClick={() => {
                setShowPw(true);
                setPwMsg(null);
                setCurPw("");
                setNewPw("");
              }}
              className="font-cinzel text-[#c8a070] hover:text-[#f5c97a] text-[0.8rem] border border-[#7a4e22] rounded-lg px-3 py-1.5 bg-[#2a1608] cursor-pointer"
              title="Schimbă parola"
            >
              🔑
            </button>
          )}
          {name && (
            <span className="font-cinzel text-[#f5c97a] text-[0.85rem] tracking-wider border border-[#7a4e22] rounded-lg px-3 py-1.5 bg-[#2a1608]">
              {name}
            </span>
          )}
          <button
            onClick={logout}
            className="bg-gradient-to-br from-[#7a4010] to-[#3d2010] border-2 border-[#c88040a0] rounded-lg text-[#f5e8c0] text-[0.8rem] font-cinzel px-3 py-1.5 hover:brightness-125 cursor-pointer"
          >
            Ieșire
          </button>
        </div>
      </header>

      <div className="flex flex-col lg:flex-row gap-4 items-start">
        {/* Left: Chat */}
        <section className="bg-gradient-to-br from-[#3d2510] to-[#2a1608] border-2 border-[#7a4e22] rounded-2xl shadow-2xl w-full lg:w-[480px] shrink-0 flex flex-col h-[480px] lg:h-[calc(100vh-200px)] lg:min-h-[560px]">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#7a4e2260]">
            <h3 className="font-cinzel text-[#f5c97a] text-[0.85rem] tracking-widest">Chat general</h3>
            <span className="text-[#a07848] text-[0.7rem]">{messages.length} mesaje</span>
          </div>
          <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-1.5">
            {messages.length === 0 ? (
              <div className="text-[#a07848] text-[0.75rem] text-center p-4">Niciun mesaj încă. Spune salut!</div>
            ) : (
              messages.map((m) => (
                <div key={m.id} className="text-[0.8rem] leading-snug">
                  <span className="font-cinzel text-[#c87030]">{m.authorName}:</span>{" "}
                  <span className="text-[#e8d8b0]">{m.text}</span>
                </div>
              ))
            )}
            <div ref={chatEndRef} />
          </div>
          <div className="p-2.5 border-t border-[#7a4e2260] flex gap-2">
            <input
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendMessage()}
              placeholder="Mesaj…"
              maxLength={500}
              className="flex-1 bg-[#1a0e05] border-2 border-[#7a4e22] rounded-lg text-[#f5c97a] text-[0.85rem] p-2 outline-none focus:border-[#c87030]"
            />
            <button
              onClick={sendMessage}
              disabled={sending || !chatInput.trim()}
              className="bg-gradient-to-br from-[#c87030] to-[#7a4010] border-2 border-[#f5c97a60] rounded-lg text-[#f5e8c0] px-3 hover:brightness-110 disabled:opacity-40 cursor-pointer"
              title="Trimite"
            >
              ➤
            </button>
          </div>
        </section>

        {/* Center: Leaderboard */}
        <section className="bg-gradient-to-br from-[#3d2510] to-[#2a1608] border-2 border-[#7a4e22] rounded-2xl shadow-2xl w-full flex-1 p-4 flex flex-col gap-2.5">
          <div className="flex items-center justify-between">
            <h3 className="font-cinzel text-[#f5c97a] text-[0.9rem] tracking-widest">👑 Clasamentul zilei</h3>
            <button
              onClick={loadLeaderboard}
              className="text-[#c8a070] hover:text-[#f5c97a] text-[0.75rem] cursor-pointer"
              title="Reîmprospătează"
            >
              ⟳
            </button>
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
                      <span className="font-cinzel truncate block text-[#f5c97a]">{meRow.name} (tu)</span>
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
        <section className="w-full lg:w-[260px] shrink-0 flex flex-col gap-4">
          <a
            href="/train"
            className="bg-gradient-to-br from-[#f5c97a] to-[#c87030] border-2 border-[#f5c97a80] rounded-2xl shadow-2xl text-center p-5 hover:brightness-110 active:translate-y-px"
          >
            <div className="font-cinzel text-[#2a1608] text-[1.1rem] tracking-widest">🏋️ Train</div>
            <div className="text-[#3d2510] text-[0.75rem] mt-1">Antrenament de viteză</div>
          </a>

          <div className="bg-gradient-to-br from-[#3d2510] to-[#2a1608] border-2 border-[#7a4e22] rounded-2xl shadow-2xl p-4 flex flex-col gap-2">
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
            className="bg-gradient-to-br from-[#3d2510] to-[#2a1608] border-2 border-[#7a4e22] rounded-2xl shadow-2xl w-full max-w-sm p-6 flex flex-col gap-3"
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
              className="bg-[#1a0e05] border-2 border-[#7a4e22] rounded-lg text-[#f5c97a] p-2.5 outline-none focus:border-[#c87030]"
            />
            <input
              type="password"
              required
              minLength={4}
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
              placeholder="Parola nouă (min 4)"
              autoComplete="new-password"
              className="bg-[#1a0e05] border-2 border-[#7a4e22] rounded-lg text-[#f5c97a] p-2.5 outline-none focus:border-[#c87030]"
            />
            {pwMsg && (
              <div className={`text-[0.8rem] ${pwMsg.ok ? "text-green-400" : "text-red-400"}`}>{pwMsg.text}</div>
            )}
            <button
              type="submit"
              disabled={pwBusy}
              className="bg-gradient-to-br from-[#c87030] to-[#7a4010] border-2 border-[#f5c97a60] rounded-lg text-[#f5e8c0] font-cinzel p-2.5 hover:brightness-110 disabled:opacity-50 cursor-pointer"
            >
              {pwBusy ? "Se salvează…" : "Salvează"}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
