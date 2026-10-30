"use client";

// The general chat, in two shapes:
//  - "page": the big card on the dashboard (kept exactly as it was);
//  - "dock": a floating pill in the corner of the game screens (/train, /duel,
//    /tower, /carciuma) so the room is reachable without leaving the table.
//
// @-mentions: typing "@" anywhere in the composer pops the roster, Enter/Tab
// completes, mentioned names render as gold chips, and a message that pings you
// gets outlined + counted on the dock so you never miss it mid-game.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BLACK_CHAT_COLOR,
  BLACK_NAME_OUTLINE,
  CHAT_COLORS,
  DEFAULT_CHAT_COLOR,
} from "@/lib/chatColors";
import ChatText from "@/components/ChatText";
import { isArt } from "@/components/PromptText";
import { mentionQueryAt } from "@/lib/mentions";
import { normalizeMessage } from "@/lib/messageText";

type Mention = { id: string | null; name: string };

interface ChatMessage {
  id: string;
  authorName: string;
  authorId?: string | null;
  text: string;
  createdAt: string;
  editedAt?: string | null;
  replyTo?: { id: string; authorName: string; text: string } | null;
  authorColor: string;
  muted: boolean;
  mentions?: Mention[];
}

type RosterPlayer = { id: string; name: string; color: string | null; online: boolean };

function clockTime(iso: string) {
  return new Date(iso).toLocaleTimeString("ro-RO", { hour: "2-digit", minute: "2-digit" });
}

// one flat line for reply quotes (newlines / ASCII art would blow the bubble up)
function oneLine(t: string) {
  const s = t.replace(/\s+/g, " ").trim();
  return s.length > 90 ? `${s.slice(0, 90)}…` : s;
}

const DOCK_KEY = "bore.chatdock.open";

export default function GeneralChat({
  variant = "page",
  refreshToken = 0,
}: {
  variant?: "page" | "dock";
  /** bump to force a full resync (rename / colour change elsewhere on the page) */
  refreshToken?: number;
}) {
  const dock = variant === "dock";

  const [me, setMe] = useState<{ id: string; name: string; isAdmin: boolean; isMuted: boolean } | null>(null);
  const [myColor, setMyColor] = useState<string>(DEFAULT_CHAT_COLOR);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const seenIds = useRef<Set<string>>(new Set());
  const lastChatAtRef = useRef<string | null>(null);
  const [chatInput, setChatInput] = useState("");
  const [sending, setSending] = useState(false);
  const [chatError, setChatError] = useState("");
  // WhatsApp-style reply: the message we're quoting (null = plain message)
  const [replyTo, setReplyTo] = useState<{ id: string; authorName: string; text: string } | null>(null);
  // inline edit: the message being rewritten, with its draft text
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  // a quoted message clicked from a reply gets flashed so the eye finds it
  const [flashId, setFlashId] = useState<string | null>(null);
  const rowRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());
  const [showColors, setShowColors] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // dock: collapsed by default, remembered per browser
  const [open, setOpen] = useState(false);
  const openRef = useRef(false);
  const [unread, setUnread] = useState(0);
  const [mentionUnread, setMentionUnread] = useState(0);
  const [toast, setToast] = useState<{ author: string; text: string } | null>(null);

  // @-autocomplete
  const [roster, setRoster] = useState<RosterPlayer[]>([]);
  const rosterAt = useRef(0);
  const [mention, setMention] = useState<{ start: number; query: string; index: number } | null>(null);

  const names = useMemo(() => roster.map((p) => p.name), [roster]);

  useEffect(() => {
    if (!dock) return;
    try {
      const saved = window.localStorage.getItem(DOCK_KEY) === "1";
      setOpen(saved);
      openRef.current = saved;
    } catch {
      /* private mode */
    }
  }, [dock]);

  const setDockOpen = useCallback((next: boolean) => {
    setOpen(next);
    openRef.current = next;
    try {
      window.localStorage.setItem(DOCK_KEY, next ? "1" : "0");
    } catch {
      /* private mode */
    }
    if (next) {
      setUnread(0);
      setMentionUnread(0);
    }
  }, []);

  // full=true loads the last 100 messages and replaces state; full=false asks the API
  // only for messages newer than our cursor and appends those we don't already have.
  const loadChat = useCallback(async (full = false) => {
    try {
      const since = !full ? lastChatAtRef.current : null;
      const res = await fetch(since ? `/api/chat?since=${encodeURIComponent(since)}` : "/api/chat", {
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = await res.json();
      const incoming: ChatMessage[] = data.messages ?? [];
      if (since) {
        // the delta poll asks for >= the cursor, so the boundary message comes back
        // every tick: dedupe by id *before* counting, or unread/mention badges inflate.
        const brandNew = incoming.filter((m) => !seenIds.current.has(m.id));
        incoming.forEach((m) => seenIds.current.add(m.id));
        if (brandNew.length) setMessages((prev) => [...prev, ...brandNew]);
        // count what arrived while the player wasn't looking at the chat
        const fresh = brandNew.filter((m) => m.authorName !== me?.name);
        const watching = !dock || openRef.current;
        if (fresh.length) {
          if (!watching) setUnread((prev) => prev + fresh.length);
          const pinged = fresh.filter((m) => !!me && (m.mentions ?? []).some((x) => x.id === me.id));
          if (pinged.length && !watching) {
            setMentionUnread((prev) => prev + pinged.length);
            const last = pinged[pinged.length - 1];
            setToast({ author: last.authorName, text: last.text });
          }
        }
      } else {
        seenIds.current = new Set(incoming.map((m) => m.id));
        setMessages(incoming);
        setUnread(0);
      }
      const newest = incoming.length ? incoming[incoming.length - 1].createdAt : null;
      if (newest) lastChatAtRef.current = newest;
    } catch {
      /* ignore */
    }
  }, [dock, me]);

  // identity (the dock lives outside the dashboard, so it fetches this itself)
  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        setMe({ id: d.id, name: d.name, isAdmin: !!d.isAdmin, isMuted: !!d.isMuted });
        setMyColor(d.nameColor ?? DEFAULT_CHAT_COLOR);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadChat(true);
    // 5s delta poll; a full resync every 30s so deletions/renames by others still land.
    let tick = 0;
    const chatTimer = setInterval(() => {
      tick += 1;
      loadChat(tick % 6 === 0);
    }, 5000);
    return () => clearInterval(chatTimer);
  }, [loadChat]);

  // rename / colour change on the dashboard must refresh every bubble
  useEffect(() => {
    if (refreshToken) loadChat(true);
  }, [refreshToken, loadChat]);

  // opening the dock clears the badge and starts from the newest message
  useEffect(() => {
    if (dock && open) {
      setUnread(0);
      setMentionUnread(0);
      setToast(null);
      requestAnimationFrame(() => {
        chatEndRef.current?.scrollIntoView({ behavior: "auto" });
      });
    }
  }, [dock, open]);

  useEffect(() => {
    if (dock && !open) return;
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, dock, open]);

  // toast retires on its own
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 8000);
    return () => clearTimeout(t);
  }, [toast]);

  const loadRoster = useCallback(async () => {
    if (Date.now() - rosterAt.current < 30_000 && roster.length) return;
    try {
      const r = await fetch("/api/players", { cache: "no-store" });
      if (!r.ok) return;
      const d = await r.json();
      setRoster(
        (d.players ?? []).map((p: { id: string; name: string; color: string | null; online: boolean }) => ({
          id: p.id,
          name: p.name,
          color: p.color,
          online: p.online,
        }))
      );
      rosterAt.current = Date.now();
    } catch {
      /* keep the stale roster — the dropdown still works */
    }
  }, [roster.length]);

  // keep the mention list in sync as the caret moves
  const syncMention = useCallback(
    (value: string, caret: number) => {
      const q = mentionQueryAt(value, caret);
      if (!q) {
        setMention(null);
        return;
      }
      void loadRoster();
      setMention((prev) => ({ start: q.start, query: q.query, index: prev && prev.start === q.start ? prev.index : 0 }));
    },
    [loadRoster]
  );

  const candidates = useMemo(() => {
    if (!mention) return [];
    const q = mention.query.toLowerCase();
    return roster
      .filter((p) => p.id !== me?.id && (!q || p.name.toLowerCase().includes(q)))
      .sort((a, b) => {
        if (a.online !== b.online) return a.online ? -1 : 1;
        const aStarts = q ? (a.name.toLowerCase().startsWith(q) ? 0 : 1) : 0;
        const bStarts = q ? (b.name.toLowerCase().startsWith(q) ? 0 : 1) : 0;
        if (aStarts !== bStarts) return aStarts - bStarts;
        return a.name.localeCompare(b.name, "ro");
      })
      .slice(0, 8);
  }, [mention, roster, me?.id]);

  const pickMention = useCallback(
    (name: string) => {
      const el = inputRef.current;
      const caret = el?.selectionStart ?? chatInput.length;
      const q = mentionQueryAt(chatInput, caret);
      const start = q?.start ?? mention?.start ?? caret;
      const next = `${chatInput.slice(0, start)}@${name} ${chatInput.slice(caret)}`;
      setChatInput(next);
      setMention(null);
      const pos = start + name.length + 2;
      requestAnimationFrame(() => {
        el?.focus();
        el?.setSelectionRange(pos, pos);
      });
    },
    [chatInput, mention]
  );

  const sendMessage = async () => {
    // normalize, not .trim(): trimming would shift row 1 of pasted ASCII art
    const text = normalizeMessage(chatInput);
    if (!text || sending) return;
    setSending(true);
    setChatError("");
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, replyToId: replyTo?.id ?? null }),
      });
      if (res.ok) {
        setChatInput("");
        setMention(null);
        setReplyTo(null);
        loadChat(true);
      } else {
        const d = await res.json().catch(() => ({}));
        setChatError(d.error || "Mesajul nu a fost trimis.");
      }
    } catch {
      setChatError("Eroare de rețea.");
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

  // ---- reply (WhatsApp-style) ----
  const startReply = (m: ChatMessage) => {
    setReplyTo({ id: m.id, authorName: m.authorName, text: m.text });
    setEditing(null);
    setMention(null);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  // jump to the quoted message and flash it for a moment
  const jumpTo = (id: string) => {
    const el = rowRefs.current.get(id);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setFlashId(id);
  };

  useEffect(() => {
    if (!flashId) return;
    const t = setTimeout(() => setFlashId(null), 1600);
    return () => clearTimeout(t);
  }, [flashId]);

  // ---- inline edit ----
  const startEdit = (m: ChatMessage) => {
    setEditing({ id: m.id, text: m.text });
    setReplyTo(null);
    setMention(null);
    setChatError("");
  };

  const saveEdit = async () => {
    if (!editing || savingEdit) return;
    const text = normalizeMessage(editing.text);
    if (!text) {
      setChatError("Mesajul nu poate fi gol.");
      return;
    }
    setSavingEdit(true);
    setChatError("");
    try {
      const res = await fetch(`/api/chat/${editing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (res.ok) {
        setEditing(null);
        loadChat(true);
      } else {
        const d = await res.json().catch(() => ({}));
        setChatError(d.error || "Mesajul nu a putut fi editat.");
      }
    } catch {
      setChatError("Eroare de rețea.");
    } finally {
      setSavingEdit(false);
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

  const onComposerKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mention && candidates.length) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMention((m) => (m ? { ...m, index: (m.index + 1) % candidates.length } : m));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMention((m) => (m ? { ...m, index: (m.index - 1 + candidates.length) % candidates.length } : m));
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        pickMention(candidates[mention.index]?.name ?? candidates[0].name);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMention(null);
        return;
      }
    }
    // Enter sends, Shift+Enter breaks the line (art needs real newlines)
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
    if (e.key === "Escape" && dock) setDockOpen(false);
  };

  const myName = me?.name ?? null;
  const pinged = (m: ChatMessage) => !!me && (m.mentions ?? []).some((x) => x.id === me.id);

  const bubbleList = (
    <div ref={scrollRef} className="flex-1 overflow-y-auto p-3.5 flex flex-col gap-1.5">
      {messages.length === 0 ? (
        <div className="text-[#75938f] text-[0.75rem] text-center p-4">Niciun mesaj încă. Spune salut!</div>
      ) : (
        messages.map((m) => {
          const isMine = !!me && m.authorId === me.id;
          const canEdit = !!me && !me.isMuted && (isMine || me.isAdmin);
          const isEditing = editing?.id === m.id;
          const isFlashing = flashId === m.id;
          return (
            <div
              key={m.id}
              ref={(el) => {
                rowRefs.current.set(m.id, el);
              }}
              data-mention={pinged(m) ? "1" : undefined}
              className={`text-[0.98rem] leading-relaxed flex items-start gap-1 group rounded-md transition-colors ${
                pinged(m) ? "border-l-2 border-[#ffd98e] bg-[#ffd98e12] pl-1.5 py-0.5" : ""
              } ${isFlashing ? "ring-2 ring-[#ffd98e]/70 bg-[#ffd98e14]" : ""}`}
            >
              {/* art gets its own block under the name: a <pre> starts on the
                  next line instead of visually splitting the first row off */}
              <div className="flex-1 min-w-0 flex flex-col">
                {m.replyTo && (
                  <button
                    type="button"
                    onClick={() => jumpTo(m.replyTo!.id)}
                    className="mb-0.5 flex w-full min-w-0 items-baseline gap-1.5 rounded border-l-2 border-[#6f9c99] bg-[#122420] px-2 py-1 text-left text-[0.72rem] leading-snug text-[#8fb0ac] hover:bg-[#16302b] cursor-pointer"
                    title="Vezi mesajul citat"
                  >
                    <span className="shrink-0 font-cinzel text-[#9ec6c1]">{m.replyTo.authorName}</span>
                    <span className="min-w-0 truncate">{oneLine(m.replyTo.text)}</span>
                  </button>
                )}
                {isEditing ? (
                  <div className="flex flex-col gap-1 my-1">
                    <textarea
                      autoFocus
                      value={editing.text}
                      onChange={(e) => setEditing({ id: editing.id, text: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") {
                          e.preventDefault();
                          setEditing(null);
                        }
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          void saveEdit();
                        }
                      }}
                      maxLength={2000}
                      rows={Math.min(6, Math.max(2, editing.text.split("\n").length))}
                      className="w-full resize-none bg-[#050d0b] border-2 border-[#6f9c99] rounded-lg text-[#cbdcda] text-base sm:text-[0.95rem] p-2 outline-none focus:border-[#9ec6c1] font-mono"
                      aria-label="Editează mesajul"
                    />
                    <div className="flex items-center gap-1.5 text-[0.72rem]">
                      <button
                        onClick={() => void saveEdit()}
                        disabled={savingEdit}
                        className="rounded border border-[#8fd9a8]/60 bg-[#1a3a35] px-2 py-0.5 font-cinzel text-[#b9f5cd] cursor-pointer hover:brightness-125 disabled:opacity-40"
                      >
                        {savingEdit ? "Salvez…" : "Salvează"}
                      </button>
                      <button
                        onClick={() => setEditing(null)}
                        className="rounded border border-[#1e3a34] px-2 py-0.5 text-[#8fb0ac] cursor-pointer hover:text-[#cbdcda]"
                      >
                        Anulează
                      </button>
                      <span className="text-[#5d7a76]">Enter = salvează · Esc = anulează</span>
                    </div>
                  </div>
                ) : (
                  <div className={isArt(m.text) ? "flex flex-col" : "flex items-start gap-1"}>
                    <span
                      className="font-cinzel shrink-0"
                      style={{
                        color: m.authorColor,
                        textShadow:
                          m.authorColor === BLACK_CHAT_COLOR
                            ? `-1.5px -1.5px 0 ${BLACK_NAME_OUTLINE}, 1.5px -1.5px 0 ${BLACK_NAME_OUTLINE}, -1.5px 1.5px 0 ${BLACK_NAME_OUTLINE}, 1.5px 1.5px 0 ${BLACK_NAME_OUTLINE}, 0 -1.5px 0 ${BLACK_NAME_OUTLINE}, 0 1.5px 0 ${BLACK_NAME_OUTLINE}, -1.5px 0 0 ${BLACK_NAME_OUTLINE}, 1.5px 0 0 ${BLACK_NAME_OUTLINE}, 0 0 8px rgba(181,126,220,0.7)`
                            : "0 1px 2px rgba(0,0,0,0.9)",
                      }}
                    >
                      {m.authorName}
                      {m.muted && (
                        <span className="text-[#75938f] text-[0.65rem] ml-1" title="mutat">
                          🔇
                        </span>
                      )}
                      {isArt(m.text) ? ":" : ": "}
                    </span>
                    <span className="text-[#cbdcda] flex-1 min-w-0">
                      <ChatText text={m.text} names={names} />
                    </span>
                  </div>
                )}
              </div>
              <div className="mt-0.5 flex shrink-0 flex-col items-end gap-0.5">
                <span
                  className="text-[0.58rem] tabular-nums text-[#5d7a76] group-hover:text-[#8fb0ac]"
                  title={new Date(m.createdAt).toLocaleString("ro-RO")}
                >
                  {clockTime(m.createdAt)}
                  {m.editedAt && <span className="ml-1 text-[#5d7a76]">· editat</span>}
                </span>
                <div className="flex items-center gap-1 opacity-70 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => startReply(m)}
                    className="text-[#75938f] hover:text-[#9ec6c1] text-[0.7rem] cursor-pointer"
                    title="Răspunde"
                    aria-label={`Răspunde lui ${m.authorName}`}
                  >
                    ↩
                  </button>
                  {canEdit && (
                    <button
                      onClick={() => startEdit(m)}
                      className="text-[#75938f] hover:text-[#ffd98e] text-[0.7rem] cursor-pointer"
                      title="Editează mesajul"
                      aria-label="Editează mesajul"
                    >
                      ✎
                    </button>
                  )}
                  {me?.isAdmin && (
                    <button
                      onClick={() => deleteMessage(m.id)}
                      className="text-[#75938f] hover:text-red-400 text-[0.7rem] cursor-pointer"
                      title="Șterge mesajul"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })
      )}
      <div ref={chatEndRef} />
    </div>
  );

  const composer = (
    <div className="p-[0.7rem] border-t border-[#1e3a3460] flex flex-col gap-1.5">
      {chatError && <div className="text-[0.72rem] text-red-400">{chatError}</div>}
      {replyTo && (
        <div className="flex items-center gap-2 rounded-lg border-l-2 border-[#ffd98e] bg-[#122420] px-2 py-1 text-[0.72rem]">
          <div className="min-w-0 flex-1">
            <span className="block font-cinzel text-[#ffd98e]">Răspunzi la {replyTo.authorName}</span>
            <span className="block truncate text-[#8fb0ac]">{oneLine(replyTo.text)}</span>
          </div>
          <button
            type="button"
            onClick={() => setReplyTo(null)}
            className="shrink-0 text-[#75938f] hover:text-[#cbdcda] cursor-pointer px-1"
            title="Renunță la răspuns"
            aria-label="Renunță la răspuns"
          >
            ✕
          </button>
        </div>
      )}
      <div className="flex gap-2">
        <div className="relative flex-1">
          {/* @-autocomplete: sits above the composer, thumb-friendly in the dock */}
          {mention && candidates.length > 0 && (
            <div
              className="absolute bottom-full left-0 right-0 mb-1.5 z-30 max-h-[210px] overflow-y-auto rounded-lg border-2 border-[#1e3a34] bg-[#0c1a17] shadow-2xl"
              role="listbox"
              aria-label="Menționează un jucător"
            >
              {candidates.map((p, i) => (
                <button
                  type="button"
                  key={p.id}
                  role="option"
                  aria-selected={i === mention.index}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pickMention(p.name);
                  }}
                  className={`flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-[0.8rem] cursor-pointer ${
                    i === mention.index ? "bg-[#1e3a34] text-[#e2eeeb]" : "text-[#cbdcda] hover:bg-[#122420]"
                  }`}
                >
                  <span className={`text-[0.55rem] ${p.online ? "text-[#8fd9a8]" : "text-[#3f5c58]"}`}>●</span>
                  <span className="truncate" style={{ color: p.color || "#cbdcda" }}>
                    {p.name}
                  </span>
                </button>
              ))}
            </div>
          )}
          <textarea
            ref={inputRef}
            value={chatInput}
            onChange={(e) => {
              setChatInput(e.target.value);
              syncMention(e.target.value, e.target.selectionStart ?? e.target.value.length);
            }}
            onKeyDown={onComposerKey}
            onClick={(e) => syncMention(chatInput, e.currentTarget.selectionStart ?? chatInput.length)}
            onBlur={() => setMention(null)}
            placeholder={replyTo ? `Răspunde lui ${replyTo.authorName}…` : "Mesaj… (@ mențiune)"}
            title="Shift+Enter = linie nouă · @ = menționează un jucător"
            maxLength={2000}
            rows={Math.min(6, Math.max(1, chatInput.split("\n").length))}
            className="w-full resize-none bg-[#050d0b] border-2 border-[#1e3a34] rounded-lg text-[#9ec6c1] text-base sm:text-[0.95rem] p-[0.65rem] outline-none focus:border-[#6f9c99] font-mono"
          />
        </div>
        <button
          onClick={sendMessage}
          disabled={sending || !chatInput.trim()}
          className="bg-gradient-to-br from-[#6f9c99] to-[#2c514c] border-2 border-[#9ec6c160] rounded-lg text-[#e2eeeb] px-3.5 min-w-[44px] hover:brightness-110 disabled:opacity-40 cursor-pointer"
          title="Trimite"
          aria-label="Trimite mesajul"
        >
          ➤
        </button>
      </div>
    </div>
  );

  const colorPicker = showColors && (
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
  );

  if (!dock) {
    return (
      <section className="bg-gradient-to-br from-[#122420] to-[#0c1a17] border-2 border-[#1e3a34] rounded-2xl shadow-2xl w-full lg:w-[600px] shrink-0 flex flex-col h-[560px] lg:h-[calc(100vh-130px)] lg:min-h-[672px]">
        <div className="flex items-center justify-between px-[1.15rem] py-[0.7rem] border-b border-[#1e3a3460] relative">
          <h3 className="font-cinzel text-[#9ec6c1] text-[0.85rem] tracking-widest">Chat general</h3>
          <div className="flex items-center gap-2">
            {myName && (
              <button
                onClick={() => setShowColors((v) => !v)}
                className="text-[0.9rem] cursor-pointer hover:scale-110 transition-transform"
                title="Culoarea numelui tău"
              >
                🎨
              </button>
            )}
          </div>
          {colorPicker}
        </div>
        {bubbleList}
        {composer}
      </section>
    );
  }

  // ---- docked (in-game) shape ----
  return (
    <div className="fixed right-3 z-[60] flex flex-col items-end gap-2 bottom-[calc(0.75rem+env(safe-area-inset-bottom))]">
      {toast && !open && (
        <button
          onClick={() => setDockOpen(true)}
          className="max-w-[280px] rounded-xl border-2 border-[#ffd98e80] bg-[#1b1508]/95 px-3 py-2 text-left shadow-2xl backdrop-blur cursor-pointer"
        >
          <span className="block text-[0.62rem] uppercase tracking-wider text-[#ffd98e]">te-a menționat</span>
          <span className="block truncate text-[0.8rem] text-[#e8e3d2]">{toast.author}</span>
          <span className="block max-h-[2.6em] overflow-hidden text-[0.72rem] leading-snug text-[#a9bdb9]">
            {toast.text.replace(/\s+/g, " ").slice(0, 90)}
          </span>
        </button>
      )}

      {open && (
        <div className="w-[min(92vw,360px)] h-[min(62vh,470px)] flex flex-col rounded-2xl border-2 border-[#1e3a34] bg-gradient-to-br from-[#122420] to-[#0c1a17] shadow-[0_18px_50px_rgba(0,0,0,0.6)] overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-[#1e3a3460] relative shrink-0">
            <h3 className="font-cinzel text-[#9ec6c1] text-[0.78rem] tracking-widest">Chat general</h3>
            <div className="flex items-center gap-2">
              {myName && (
                <button
                  onClick={() => setShowColors((v) => !v)}
                  className="text-[0.85rem] cursor-pointer"
                  title="Culoarea numelui tău"
                >
                  🎨
                </button>
              )}
              <button
                onClick={() => setDockOpen(false)}
                className="text-[#75938f] hover:text-[#9ec6c1] cursor-pointer text-[0.9rem] px-1"
                title="Strânge chatul"
                aria-label="Strânge chatul"
              >
                ✕
              </button>
            </div>
            {colorPicker}
          </div>
          {bubbleList}
          {composer}
        </div>
      )}

      {!open && (
        <button
          onClick={() => setDockOpen(true)}
          className={`flex items-center gap-2 rounded-full border-2 px-3.5 min-h-[46px] shadow-2xl cursor-pointer backdrop-blur ${
            mentionUnread
              ? "border-[#ffd98e] bg-[#2a2010]/95 text-[#ffd98e] animate-pulse"
              : "border-[#2c514c] bg-[#0c1a17]/95 text-[#9ec6c1]"
          }`}
          title="Chat general"
          aria-label="Deschide chatul general"
        >
          <span className="text-[0.95rem]">💬</span>
          <span className="font-cinzel text-[0.78rem] tracking-wider">Chat</span>
          {mentionUnread > 0 ? (
            <span className="rounded-full bg-[#ffd98e] px-1.5 text-[0.65rem] font-bold text-[#1b1508]">
              @{mentionUnread}
            </span>
          ) : unread > 0 ? (
            <span className="rounded-full bg-[#2c514c] px-1.5 text-[0.65rem] font-bold text-[#d6ece8]">{unread}</span>
          ) : null}
        </button>
      )}
    </div>
  );
}
