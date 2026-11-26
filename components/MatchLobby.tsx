"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { stoneSound } from "@/lib/sound";

export type LobbyGameType = "fight" | "siege" | "turnul" | "train";

export interface LobbySeat {
  seatIndex: number;
  userId: string;
  name: string;
  isBot: boolean;
  botDifficulty?: "easy" | "medium" | "hard";
  ready: boolean;
  score: number;
}

export interface LobbyRoom {
  code: string;
  gameType: LobbyGameType;
  hostId: string;
  hostName: string;
  maxSeats: number;
  status: "waiting" | "playing" | "finished";
  seats: LobbySeat[];
}

export interface OnlinePlayer {
  userId: string;
  name: string;
  lastSeen: number;
  page?: string;
}

export interface PendingInvite {
  id: string;
  fromUserId: string;
  fromName: string;
  toUserId: string;
  roomCode: string;
  gameType: LobbyGameType;
}

interface MatchLobbyProps {
  gameType: LobbyGameType;
  maxSeats: number;
  botDifficulty: "easy" | "medium" | "hard";
  onDifficultyChange?: (d: "easy" | "medium" | "hard") => void;
  initialRoomCode?: string | null;
  onSeatsChange: (seats: LobbySeat[], room: LobbyRoom | null) => void;
}

export function MatchLobby({
  gameType,
  maxSeats,
  botDifficulty,
  onDifficultyChange,
  initialRoomCode,
  onSeatsChange,
}: MatchLobbyProps) {
  const { lang, t } = useI18n();
  const [room, setRoom] = useState<LobbyRoom | null>(null);
  const [onlinePlayers, setOnlinePlayers] = useState<OnlinePlayer[]>([]);
  const [invitedIds, setInvitedIds] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState(false);
  const [joinInput, setJoinInput] = useState("");
  const [joinErr, setJoinErr] = useState("");
  const initDoneRef = useRef(false);
  const onSeatsChangeRef = useRef(onSeatsChange);
  onSeatsChangeRef.current = onSeatsChange;

  const syncRoom = useCallback((next: LobbyRoom | null) => {
    setRoom(next);
    onSeatsChangeRef.current(next?.seats ?? [], next);
  }, []);

  // Create or join room on mount
  useEffect(() => {
    if (initDoneRef.current) return;
    initDoneRef.current = true;
    const init = async () => {
      try {
        if (initialRoomCode) {
          const res = await fetch("/api/rooms", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "join", code: initialRoomCode }),
          });
          if (res.ok) {
            const d = await res.json();
            syncRoom(d.room);
            return;
          }
        }
        const res = await fetch("/api/rooms", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "create", gameType, maxSeats, lang }),
        });
        if (res.ok) {
          const d = await res.json();
          syncRoom(d.room);
        }
      } catch {
        /* ignore */
      }
    };
    init();
  }, [gameType, initialRoomCode, lang, maxSeats, syncRoom]);

  // Poll room & online players every 3s
  useEffect(() => {
    const poll = async () => {
      try {
        const q = room?.code ? `?code=${encodeURIComponent(room.code)}&page=/${gameType}` : `?page=/${gameType}`;
        const res = await fetch(`/api/rooms${q}`);
        if (!res.ok) return;
        const data = await res.json();
        if (Array.isArray(data.onlinePlayers)) setOnlinePlayers(data.onlinePlayers);
        if (data.room) syncRoom(data.room);
      } catch {
        /* ignore */
      }
    };
    poll();
    const id = setInterval(poll, 3000);
    return () => clearInterval(id);
  }, [gameType, room?.code, syncRoom]);

  const callRoom = async (payload: Record<string, unknown>) => {
    if (!room) return;
    const res = await fetch("/api/rooms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: room.code, ...payload }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.room) syncRoom(data.room);
    }
  };

  const handleJoinCode = async () => {
    const c = joinInput.trim().toUpperCase();
    if (!c) return;
    setJoinErr("");
    const res = await fetch("/api/rooms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "join", code: c }),
    });
    if (!res.ok) {
      setJoinErr("Code not found");
      return;
    }
    const data = await res.json();
    if (data.room) {
      setJoinInput("");
      syncRoom(data.room);
    }
  };

  const copyInviteLink = () => {
    if (!room) return;
    const url = `${window.location.origin}/${gameType}?room=${room.code}`;
    navigator.clipboard?.writeText(url).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const invitePlayer = async (uid: string) => {
    await callRoom({ action: "invite", toUserId: uid });
    setInvitedIds((prev) => new Set(prev).add(uid));
    stoneSound.invitePing();
  };

  const seats = room?.seats ?? [];
  const openCount = Math.max(0, maxSeats - seats.length);

  return (
    <div className="royal-panel rounded-2xl p-4 sm:p-5 flex flex-col gap-4">
      {/* Header + Room Code + Copy Invite */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#b68635]/40 pb-3">
        <div className="flex items-center gap-2">
          <span className="text-base">🏰</span>
          <h3 className="font-cinzel font-extrabold text-xs sm:text-sm tracking-[0.14em] uppercase text-[#ffd977]">
            {t("lobbyTitle")}
          </h3>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {room && (
            <>
              <span className="bg-[#0e0a14] border border-[#b68635]/70 rounded-lg px-3 py-1 text-xs font-cinzel text-[#f3dfb4]">
                {t("lobbyRoomCode")}: <strong className="text-[#ffe28a] tracking-widest">{room.code}</strong>
              </span>
              <button
                type="button"
                onClick={copyInviteLink}
                className="btn-sapphire rounded-lg px-3 py-1 text-xs font-cinzel font-bold cursor-pointer"
              >
                🔗 {copied ? t("lobbyCopied") : t("lobbyCopyLink")}
              </button>
            </>
          )}
          <div className="flex items-center gap-1">
            <input
              value={joinInput}
              onChange={(e) => setJoinInput(e.target.value.toUpperCase().slice(0, 6))}
              onKeyDown={(e) => e.key === "Enter" && handleJoinCode()}
              placeholder={t("lobbyJoinCode")}
              className="w-24 bg-[#0b0910] border border-[#8e672b] rounded-lg px-2 py-1 text-xs text-[#ffe28a] font-cinzel uppercase outline-none focus:border-[#f5cd71]"
            />
            <button
              type="button"
              onClick={handleJoinCode}
              className="bg-[#231932] hover:bg-[#34254a] border border-[#b68635] rounded-lg px-2.5 py-1 text-xs font-cinzel text-[#ffefc8] cursor-pointer"
            >
              {t("lobbyJoinBtn")}
            </button>
          </div>
          {joinErr && <span className="text-[0.68rem] text-rose-400">{joinErr}</span>}
        </div>
      </div>

      {/* Seats Grid + Online Players Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.35fr_1fr] gap-4">
        {/* Seats */}
        <div className="flex flex-col gap-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-cinzel font-bold uppercase tracking-wider text-[#dfc79a]">
              {t("lobbySeats")} ({seats.length}/{maxSeats})
            </span>

            <div className="flex items-center gap-2 flex-wrap">
              {onDifficultyChange && (
                <div className="flex items-center gap-1 text-[0.68rem] font-cinzel">
                  {(["easy", "medium", "hard"] as const).map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => onDifficultyChange(d)}
                      className={`px-2 py-0.5 rounded border cursor-pointer ${
                        botDifficulty === d
                          ? "bg-[#b87a24] border-[#ffe28a] text-[#1a0f05] font-extrabold"
                          : "bg-[#120e1a] border-[#7a5828] text-[#d6be92]"
                      }`}
                    >
                      {d === "easy" ? t("lobbyDiffEasy") : d === "medium" ? t("lobbyDiffMedium") : t("lobbyDiffHard")}
                    </button>
                  ))}
                </div>
              )}

              {openCount > 0 && (
                <button
                  type="button"
                  onClick={() => callRoom({ action: "fillBots", difficulty: botDifficulty })}
                  className="btn-crimson rounded-lg px-3 py-1 text-[0.7rem] font-cinzel font-bold tracking-wider uppercase cursor-pointer"
                >
                  🤖 {t("lobbyFillBots")}
                </button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {Array.from({ length: maxSeats }).map((_, idx) => {
              const seat = seats[idx];
              if (seat) {
                return (
                  <div
                    key={seat.userId}
                    className={`rounded-xl px-3 py-2 border flex items-center justify-between gap-2 ${
                      seat.isBot
                        ? "bg-[#161326]/90 border-[#6879b3]/60"
                        : "bg-[#221712]/90 border-[#d4a147]"
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-cinzel font-bold text-[#ffefc8] truncate">
                        {seat.isBot ? "🤖 " : "👑 "}
                        {seat.name}
                      </div>
                      <div className="text-[0.62rem] text-[#cbb07e]">
                        {idx === 0 ? t("lobbyHost") : seat.isBot ? `${t("lobbyBot")} • ${seat.botDifficulty || botDifficulty}` : "Online"}
                      </div>
                    </div>
                    {idx > 0 && (
                      <button
                        type="button"
                        onClick={() => callRoom({ action: "removeSeat", seatIndex: idx })}
                        className="text-rose-400 hover:text-rose-200 text-xs font-bold px-1 cursor-pointer"
                        title={t("lobbyRemove")}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                );
              }
              return (
                <button
                  key={`open-${idx}`}
                  type="button"
                  onClick={() => callRoom({ action: "addBot", difficulty: botDifficulty })}
                  className="rounded-xl px-3 py-2 border border-dashed border-[#8e672b]/70 bg-[#0d0a13]/70 hover:border-[#f5cd71] hover:bg-[#1a1426] text-left flex items-center justify-between gap-1 cursor-pointer transition-all"
                >
                  <span className="text-xs text-[#a9936d]">{t("lobbyEmptySeat")}</span>
                  <span className="text-[0.68rem] font-cinzel font-bold text-[#f3ca6b]">{t("lobbyAddBot")}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Online Players Invite List */}
        <div className="bg-[#0e0b15]/80 border border-[#7a5828]/50 rounded-xl p-3 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-cinzel font-bold uppercase tracking-wider text-[#7ee39b] flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              {t("lobbyOnlinePlayers")} ({onlinePlayers.length})
            </span>
          </div>
          {onlinePlayers.length === 0 ? (
            <p className="text-[0.72rem] text-[#b49b72] leading-relaxed my-auto py-2">
              {t("lobbyNoOnline")}
            </p>
          ) : (
            <div className="flex flex-col gap-1.5 max-h-[120px] overflow-y-auto">
              {onlinePlayers.map((p) => {
                const alreadyIn = seats.some((s) => s.userId === p.userId);
                const sent = invitedIds.has(p.userId);
                return (
                  <div
                    key={p.userId}
                    className="flex items-center justify-between gap-2 bg-[#161224] border border-[#7a5828]/40 rounded-lg px-2.5 py-1.5"
                  >
                    <span className="text-xs font-cinzel font-bold text-[#f6ead0] truncate">{p.name}</span>
                    {alreadyIn ? (
                      <span className="text-[0.65rem] text-emerald-400 font-bold">✓</span>
                    ) : (
                      <button
                        type="button"
                        disabled={sent}
                        onClick={() => invitePlayer(p.userId)}
                        className="btn-sapphire rounded-md px-2.5 py-0.5 text-[0.66rem] font-cinzel font-bold cursor-pointer disabled:opacity-55"
                      >
                        {sent ? t("lobbyInvited") : `📩 ${t("lobbyInviteBtn")}`}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Global floating invite toast (shows on Dashboard or any page when an online player invites you)
export function InviteToast() {
  const { t } = useI18n();
  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const seenRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch("/api/rooms?page=/");
        if (!res.ok) return;
        const data = await res.json();
        const list: PendingInvite[] = data.invites ?? [];
        for (const inv of list) {
          if (!seenRef.current.has(inv.id)) {
            seenRef.current.add(inv.id);
            stoneSound.invitePing();
          }
        }
        setInvites(list);
      } catch {
        /* ignore */
      }
    };
    poll();
    const id = setInterval(poll, 4000);
    return () => clearInterval(id);
  }, []);

  if (invites.length === 0) return null;

  const dismiss = async (id: string) => {
    setInvites((prev) => prev.filter((x) => x.id !== id));
    await fetch("/api/rooms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "dismissInvite", inviteId: id }),
    }).catch(() => {});
  };

  const gameLabel = (gt: LobbyGameType) => {
    if (gt === "siege") return t("siegeTitle");
    if (gt === "turnul") return t("turnulTitle");
    if (gt === "fight") return t("fightTitle");
    return t("trainTitle");
  };

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-xs w-full">
      {invites.map((inv) => (
        <div
          key={inv.id}
          className="royal-panel rounded-2xl p-3.5 border-2 border-[#ffe28a] shadow-2xl animate-gold-glow flex flex-col gap-2"
        >
          <div className="flex items-center justify-between text-xs font-cinzel font-extrabold text-[#ffe28a]">
            <span>📩 {t("lobbyInviteToastTitle")}</span>
            <span className="text-[0.65rem] text-[#d6be92]">#{inv.roomCode}</span>
          </div>
          <p className="text-xs text-[#f6ead0]">
            <strong>{inv.fromName}</strong> → <span className="text-[#ffd977]">{gameLabel(inv.gameType)}</span>
          </p>
          <div className="flex gap-2">
            <a
              href={`/${inv.gameType}?room=${inv.roomCode}`}
              className="btn-crimson flex-1 text-center rounded-lg py-1.5 text-[0.7rem] font-cinzel font-bold uppercase"
            >
              ⚔ {t("lobbyInviteToastAccept")}
            </a>
            <button
              type="button"
              onClick={() => dismiss(inv.id)}
              className="bg-[#1b1526] border border-[#8e672b] rounded-lg px-3 py-1.5 text-[0.7rem] font-cinzel text-[#d6be92] hover:text-white cursor-pointer"
            >
              {t("lobbyInviteToastDecline")}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
