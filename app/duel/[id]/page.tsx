"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Arena from "./Arena";

type AnswerRow = { userId: string; isCorrect: boolean; elapsedMs: number; score: number | null; mine: boolean };
type HistoryRow = {
  round: number;
  mode: "grila" | "rapide";
  questionId: string;
  prompt: string;
  reveal: string;
  options: { text: string; isCorrect: boolean }[] | null;
  winnerId: string | null;
  answers: AnswerRow[];
};
type DuelState = {
  id: string;
  status: "WAITING" | "IN_PROGRESS" | "COMPLETED" | "ABANDONED";
  role: "host" | "guest" | null;
  host: { id: string; name: string; score: number };
  guest: { id: string; name: string; score: number } | null;
  round: number;
  totalRounds: number;
  mode: "grila" | "rapide" | null;
  prompt: string | null;
  options: { id: string; text: string }[] | null;
  responseType: string | null;
  startedAt: number | null;
  windowMs: number | null;
  myAnswered: boolean;
  opponentAnswered: boolean;
  history: HistoryRow[];
  winnerId: string | null;
  draw: boolean;
  streakToWin: number;
  streaks: { host: number; guest: number };
  pushedOffId: string | null;
};

const CARD = "bg-gradient-to-br from-[#122420] to-[#0c1a17] border-2 border-[#1e3a34] rounded-2xl shadow-2xl";
const BTN_MAIN =
  "bg-gradient-to-br from-[#6f9c99] to-[#2c514c] border-2 border-[#9ec6c160] rounded-lg text-[#e2eeeb] font-cinzel p-3 hover:brightness-110 cursor-pointer";

export default function DuelMatch() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const [state, setState] = useState<DuelState | null>(null);
  const [err, setErr] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [selected, setSelected] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [localSent, setLocalSent] = useState(false);
  const [flash, setFlash] = useState<"ok" | "bad" | null>(null);
  const lastRound = useRef<number | null>(null);

  // ---- post-match review: report a question, or fix it in place (editors) ----
  const [canEdit, setCanEdit] = useState(false);
  const [reported, setReported] = useState<Set<string>>(new Set());
  const [reportErr, setReportErr] = useState("");
  // locally patched rounds after a successful inline edit, keyed by round number
  const [patched, setPatched] = useState<
    Record<number, { prompt: string; reveal: string; options: { text: string; isCorrect: boolean }[] | null }>
  >({});
  const [editRound, setEditRound] = useState<number | null>(null);
  const [editPrompt, setEditPrompt] = useState("");
  const [editOptions, setEditOptions] = useState<{ text: string; isCorrect: boolean }[]>([]);
  const [editAnswer, setEditAnswer] = useState("");
  const [editBusy, setEditBusy] = useState(false);
  const [editMsg, setEditMsg] = useState("");

  // Sit down (idempotent) then poll the match state.
  useEffect(() => {
    if (!id) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    (async () => {
      try {
        await fetch(`/api/duel/${id}/join`, { method: "POST" });
      } catch {
        /* ignore */
      }
      const tick = async () => {
        try {
          const r = await fetch(`/api/duel/${id}`, { cache: "no-store" });
          if (r.status === 401) {
            window.location.href = "/login";
            return;
          }
          if (r.ok) {
            setState(await r.json());
            setErr("");
          } else if (r.status === 403) setErr("Nu faci parte din acest meci.");
          else if (r.status === 404) setErr("Meciul nu există sau a expirat.");
        } catch {
          /* keep polling */
        }
        if (!stop) timer = setTimeout(tick, 1200);
      };
      tick();
    })();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [id]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(t);
  }, []);

  // editors/admins get the "edit in place" button on every round
  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setCanEdit(!!(d.isAdmin || d.canEditQuestions)))
      .catch(() => {});
  }, []);

  // New round -> clear the previous answer's local UI.
  useEffect(() => {
    if (state?.round != null && state.round !== lastRound.current) {
      lastRound.current = state.round;
      setSelected(null);
      setTyped("");
      setLocalSent(false);
      setFlash(null);
    }
  }, [state?.round]);

  const me = state ? (state.role === "host" ? state.host : state.guest) : null;
  const opp = state ? (state.role === "host" ? state.guest : state.host) : null;

  const deadline = state?.startedAt != null && state?.windowMs != null ? state.startedAt + state.windowMs : null;
  const timeLeft = deadline ? Math.max(0, (deadline - now) / 1000) : null;
  const sent = localSent || !!state?.myAnswered;
  const canAnswer =
    state?.status === "IN_PROGRESS" && state?.mode != null && !sent && (timeLeft == null || timeLeft > 0);

  async function send(payload: Record<string, unknown>) {
    setLocalSent(true);
    try {
      const r = await fetch(`/api/duel/${id}/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ round: state!.round, ...payload }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setLocalSent(false);
        setSelected(null);
        setErr(d.error || "N-am putut trimite răspunsul.");
        return;
      }
      setFlash(d.mode === "grila" ? (d.isCorrect ? "ok" : "bad") : null);
    } catch {
      setLocalSent(false);
      setErr("Eroare de rețea.");
    }
  }

  async function abandon() {
    if (!window.confirm("Abandonezi meciul?")) return;
    try {
      await fetch(`/api/duel/${id}/leave`, { method: "POST" });
    } catch {
      /* ignore */
    }
    window.location.href = "/duel";
  }

  // Player flags a bad question straight from the post-match list. The API
  // unpublishes it and drops it into the admin review queue.
  async function reportQuestion(qid: string) {
    if (reported.has(qid)) return;
    setReportErr("");
    try {
      const r = await fetch(`/api/questions/${qid}/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: "raportată din meci 1v1" }),
      });
      if (r.ok || r.status === 409) {
        setReported((prev) => new Set(prev).add(qid));
        return;
      }
      const d = await r.json().catch(() => ({}));
      setReportErr(d.error || "Nu am putut raporta întrebarea.");
    } catch {
      setReportErr("Eroare de rețea.");
    }
  }

  function openEdit(h: HistoryRow) {
    const view = { ...h, ...(patched[h.round] ?? {}) };
    setEditRound(h.round);
    setEditPrompt(view.prompt);
    setEditAnswer(view.reveal);
    const opts = (view.options ?? []).map((o) => ({ text: o.text, isCorrect: o.isCorrect }));
    while (opts.length > 0 && opts.length < 4) opts.push({ text: "", isCorrect: false });
    setEditOptions(
      opts.length === 4
        ? opts
        : [
            { text: "", isCorrect: true },
            { text: "", isCorrect: false },
            { text: "", isCorrect: false },
            { text: "", isCorrect: false },
          ]
    );
    setEditMsg("");
  }

  function closeEdit() {
    setEditRound(null);
    setEditMsg("");
  }

  async function saveEdit(h: HistoryRow) {
    setEditBusy(true);
    setEditMsg("");
    const isGrila = h.mode === "grila";
    const body = isGrila
      ? { prompt: editPrompt, options: editOptions }
      : { prompt: editPrompt, options: [{ text: editAnswer.trim(), isCorrect: true }] };
    try {
      const r = await fetch(`/api/admin/questions/${h.questionId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setEditMsg(d.error || "Nu am putut salva.");
        return;
      }
      const options = isGrila
        ? editOptions.map((o) => ({ text: o.text.trim(), isCorrect: o.isCorrect }))
        : null;
      const reveal = isGrila
        ? options?.find((o) => o.isCorrect)?.text ?? h.reveal
        : editAnswer.trim();
      setPatched((prev) => ({ ...prev, [h.round]: { prompt: editPrompt.trim(), reveal, options } }));
      setReported((prev) => {
        const next = new Set(prev);
        next.delete(h.questionId); // editing clears the report server-side
        return next;
      });
      setEditRound(null);
      setEditMsg(""); // the "✓ actualizată" chip next to the button confirms the save
    } catch {
      setEditMsg("Eroare de rețea.");
    } finally {
      setEditBusy(false);
    }
  }

  // ---------- error / empty ----------
  if (err && !state) {
    return (
      <div className={`${CARD} w-full max-w-[560px] mx-auto p-7 text-center flex flex-col gap-4`}>
        <h2 className="font-cinzel text-[#9ec6c1] text-[1.2rem]">⚔️ 1 la 1</h2>
        <p className="text-[#cbdcda] text-[0.95rem]">{err}</p>
        <button onClick={() => (window.location.href = "/duel")} className={BTN_MAIN}>
          ← Înapoi la lobby
        </button>
      </div>
    );
  }
  if (!state || !me) {
    return (
      <div className={`${CARD} w-full max-w-[560px] mx-auto p-7 text-center`}>
        <p className="text-[#75938f] text-[0.9rem]">Se încarcă meciul…</p>
      </div>
    );
  }

  const scoreboard = (
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-center">
      <div className="bg-[#050d0b] border-2 border-[#6f9c99] rounded-xl p-2.5">
        <div className="text-[0.7rem] text-[#75938f] truncate">Tu · {me.name}</div>
        <div className="font-cinzel text-[#9ec6c1] text-[1.4rem]">{me.score}</div>
      </div>
      <div className="font-cinzel text-[#1e3a34] text-[0.9rem]">VS</div>
      <div className="bg-[#050d0b] border-2 border-[#1e3a34] rounded-xl p-2.5">
        <div className="text-[0.7rem] text-[#75938f] truncate">{opp ? opp.name : "…"}</div>
        <div className="font-cinzel text-[#cbdcda] text-[1.4rem]">{opp ? opp.score : 0}</div>
      </div>
    </div>
  );

  const arena =
    state.guest != null ? (
      <Arena
        duel={{
          status: state.status,
          role: state.role,
          host: state.host,
          guest: state.guest,
          history: state.history,
          streakToWin: state.streakToWin,
          streaks: state.streaks,
          pushedOffId: state.pushedOffId,
        }}
      />
    ) : null;

  // ---------- waiting for an opponent ----------
  if (state.status === "WAITING") {
    return (
      <div className={`${CARD} w-full max-w-[520px] mx-auto p-7 flex flex-col gap-4 text-center`}>
        <h2 className="font-cinzel text-[#9ec6c1] text-[1.3rem] tracking-widest">⏳ Aștept adversarul</h2>
        <p className="text-[#cbdcda] text-[0.9rem] leading-relaxed">
          Meciul e deschis și apare pe pagina principală — oricine îl poate deschide cu <b>Join</b>. Începe automat când intră cineva.
        </p>
        <div className="flex gap-2.5">
          <a href="/" className={`${BTN_MAIN} flex-1 inline-flex items-center justify-center`}>
            Vezi lobby-ul
          </a>
          <button
            onClick={abandon}
            className="flex-1 bg-gradient-to-br from-[#101f1c] to-[#0c1a17] border-2 border-[#1e3a34] rounded-lg text-[#8fb0ac] font-cinzel p-3 hover:brightness-125 cursor-pointer"
          >
            Anulează
          </button>
        </div>
      </div>
    );
  }

  // ---------- finished / abandoned ----------
  if (state.status === "COMPLETED" || state.status === "ABANDONED") {
    const won = state.status === "COMPLETED" && state.winnerId === me.id;
    const lost = state.status === "COMPLETED" && state.winnerId != null && state.winnerId !== me.id;
    const banner =
      state.status === "ABANDONED"
        ? "🚪 Meci abandonat"
        : state.draw
          ? "🤝 Egalitate"
          : won
            ? "🏆 Ai câștigat!"
            : lost
              ? "😤 Ai pierdut"
              : "🏁 Meci încheiat";
    return (
      <div className="w-full max-w-[620px] mx-auto flex flex-col gap-4">
        <div className={`${CARD} p-6 flex flex-col gap-4 text-center`}>
          <h2 className="font-cinzel text-[#9ec6c1] text-[1.5rem]">{banner}</h2>
          {scoreboard}
          {arena}
          <div className="flex gap-2.5 flex-wrap">
            <button onClick={() => (window.location.href = "/duel")} className={`${BTN_MAIN} flex-1 min-w-[140px]`}>
              ⚔️ Încă un meci
            </button>
            <button
              onClick={() => (window.location.href = "/")}
              className="flex-1 min-w-[140px] bg-gradient-to-br from-[#2c514c] to-[#101f1c] border-2 border-[#4d7a76a0] rounded-lg text-[#e2eeeb] font-cinzel p-3 hover:brightness-125 cursor-pointer"
            >
              ← Înapoi
            </button>
          </div>
        </div>

        {state.history.length > 0 && (
          <div className={`${CARD} p-5 flex flex-col gap-2`}>
            <h3 className="font-cinzel text-[#9ec6c1] text-[0.9rem] tracking-widest">📋 Runde</h3>
            {reportErr && <div className="text-[0.72rem] text-red-400">{reportErr}</div>}
            {state.history.map((h) => {
              const view = { ...h, ...(patched[h.round] ?? {}) };
              const w = h.winnerId === me.id ? "tu" : h.winnerId ? "adversarul" : "nimeni";
              const isOpen = editRound === h.round;
              return (
                <div key={h.round} className="bg-[#050d0b] border border-[#1e3a3460] rounded-xl p-3 flex flex-col gap-1">
                  <div className="flex items-center justify-between gap-2 text-[0.72rem] text-[#75938f]">
                    <span>
                      #{h.round + 1} · {h.mode === "rapide" ? "Rapidă" : "Grilă"}
                    </span>
                    <span className={h.winnerId === me.id ? "text-green-400" : h.winnerId ? "text-red-400" : "text-[#75938f]"}>
                      {h.winnerId === me.id ? "✔ câștigată" : h.winnerId ? "✖ pierdută" : "– egal"}
                    </span>
                  </div>
                  <div className="text-[0.88rem] text-[#cbdcda] leading-snug">{view.prompt}</div>
                  <div className="text-[0.78rem] text-[#8fb0ac]">
                    Corect: <strong className="text-[#9ec6c1]">{view.reveal}</strong>
                    {h.answers.map((a, i) => (
                      <span key={i} className={a.mine ? "text-[#9ec6c1]" : "text-[#75938f]"}>
                        {" · "}
                        {a.mine ? "tu" : "adv"} {a.isCorrect ? "✔" : "✖"} {(a.elapsedMs / 1000).toFixed(1)}s
                        {a.score != null ? ` (${a.score}p)` : ""}
                      </span>
                    ))}
                    <span className="text-[#25443f]"> · câștigă: {w}</span>
                  </div>

                  {/* report / fix in place — same card, never the admin page */}
                  <div className="flex items-center justify-end gap-2 pt-0.5">
                    {patched[h.round] && <span className="text-[0.68rem] text-green-400">✓ actualizată</span>}
                    {canEdit && (
                      <button
                        onClick={() => (isOpen ? closeEdit() : openEdit(h))}
                        className="text-[0.7rem] text-[#8fb0ac] border border-[#1e3a34] rounded px-2 py-0.5 hover:bg-[#122420] cursor-pointer"
                        title="Editează întrebarea aici"
                      >
                        {isOpen ? "✕ Închide" : "✏️ Editează"}
                      </button>
                    )}
                    {reported.has(h.questionId) ? (
                      <span className="text-[0.7rem] text-[#8fb0ac]">Raportată ✓</span>
                    ) : (
                      <button
                        onClick={() => void reportQuestion(h.questionId)}
                        className="text-[0.7rem] text-red-400/90 border border-red-500/40 rounded px-2 py-0.5 hover:bg-red-900/30 cursor-pointer"
                        title="Raportează întrebarea (iese din joc până e verificată)"
                      >
                        ⚠ Raportează
                      </button>
                    )}
                  </div>

                  {isOpen && (
                    <div className="mt-1 border-t border-[#1e3a3460] pt-2 flex flex-col gap-2">
                      <textarea
                        value={editPrompt}
                        onChange={(e) => setEditPrompt(e.target.value)}
                        rows={3}
                        className="w-full bg-[#0c1a17] border border-[#1e3a34] rounded-lg p-2 text-[0.85rem] text-[#d3e3e1] outline-none focus:border-[#6f9c99]"
                        placeholder="Textul întrebării"
                      />
                      {h.mode === "grila" ? (
                        <div className="flex flex-col gap-1.5">
                          {editOptions.map((o, i) => (
                            <label key={i} className="flex items-center gap-2">
                              <input
                                type="radio"
                                name={`correct-${h.round}`}
                                checked={o.isCorrect}
                                onChange={() =>
                                  setEditOptions((prev) => prev.map((x, j) => ({ ...x, isCorrect: j === i })))
                                }
                                className="accent-[#6f9c99]"
                                title="Varianta corectă"
                              />
                              <span className="text-[0.72rem] text-[#6f9c99] w-3">{String.fromCharCode(65 + i)}.</span>
                              <input
                                value={o.text}
                                onChange={(e) =>
                                  setEditOptions((prev) => prev.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))
                                }
                                className="flex-1 bg-[#0c1a17] border border-[#1e3a34] rounded-lg p-1.5 text-[0.82rem] text-[#d3e3e1] outline-none focus:border-[#6f9c99]"
                              />
                            </label>
                          ))}
                          <span className="text-[0.66rem] text-[#25443f]">bifează varianta corectă</span>
                        </div>
                      ) : (
                        <label className="flex items-center gap-2">
                          <span className="text-[0.72rem] text-[#8fb0ac]">Răspuns:</span>
                          <input
                            value={editAnswer}
                            onChange={(e) => setEditAnswer(e.target.value)}
                            inputMode="numeric"
                            className="w-32 bg-[#0c1a17] border border-[#1e3a34] rounded-lg p-1.5 text-[0.82rem] text-[#d3e3e1] outline-none focus:border-[#6f9c99]"
                          />
                        </label>
                      )}
                      {editMsg && <div className="text-[0.72rem] text-red-400">{editMsg}</div>}
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={closeEdit}
                          className="text-[0.72rem] text-[#8fb0ac] border border-[#1e3a34] rounded px-2.5 py-1 hover:bg-[#122420] cursor-pointer"
                        >
                          Anulează
                        </button>
                        <button
                          onClick={() => void saveEdit(h)}
                          disabled={editBusy}
                          className="text-[0.72rem] text-[#e2eeeb] bg-gradient-to-br from-[#6f9c99] to-[#2c514c] border border-[#9ec6c160] rounded px-2.5 py-1 hover:brightness-110 disabled:opacity-50 cursor-pointer"
                        >
                          {editBusy ? "Se salvează…" : "Salvează"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ---------- playing ----------
  const isGrila = state.mode === "grila";
  const pct = timeLeft != null && state.windowMs ? (timeLeft / (state.windowMs / 1000)) * 100 : 0;
  const chips = state.history.slice(-8);

  return (
    <div className="w-full max-w-[620px] mx-auto flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <button
          onClick={abandon}
          className="text-[#8fb0ac] hover:text-[#9ec6c1] text-[0.85rem] font-cinzel border border-[#1e3a34] rounded-lg px-3 py-1.5 bg-[#0c1a17] cursor-pointer"
        >
          🚪 Abandonează
        </button>
        <span className="text-[0.7rem] text-[#75938f]">
          Runda {state.round + 1} / {state.totalRounds} · {isGrila ? "Grilă" : "Rapidă"}
          {" · "}
          <span className="text-[#9ec6c1]">{state.streakToWin} la rând câștigă</span>
        </span>
      </div>

      {scoreboard}

      {arena}

      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1.5 justify-center">
          {chips.map((h) => (
            <span
              key={h.round}
              title={h.prompt}
              className={`text-[0.68rem] px-2 py-0.5 rounded-full border ${
                h.winnerId === me.id
                  ? "border-green-500/50 text-green-400 bg-green-900/20"
                  : h.winnerId
                    ? "border-red-500/50 text-red-400 bg-red-900/20"
                    : "border-[#1e3a34] text-[#75938f] bg-[#050d0b]"
              }`}
            >
              #{h.round + 1} {h.mode === "rapide" ? "R" : "G"}
            </span>
          ))}
        </div>
      )}

      <div className={`${CARD} p-7 flex flex-col gap-5`}>
        <div className="flex items-center gap-3">
          <div
            className={`w-[52px] h-[52px] rounded-full border-2 flex items-center justify-center font-cinzel text-[1.1rem] shrink-0 ${
              timeLeft != null && timeLeft <= 3 ? "border-red-500 text-red-400" : "border-[#9ec6c1] text-[#9ec6c1]"
            }`}
          >
            {timeLeft != null ? Math.ceil(timeLeft) : "–"}
          </div>
          <div className="flex-1 h-2 bg-[#050d0b] rounded overflow-hidden border border-[#1e3a3440]">
            <div
              className={`h-full transition-all duration-100 ${timeLeft != null && timeLeft <= 3 ? "bg-red-500" : "bg-gradient-to-r from-[#6f9c99] to-[#9ec6c1]"}`}
              style={{ width: `${pct}%` }}
            ></div>
          </div>
        </div>

        <p className="font-cinzel text-[1.05rem] leading-relaxed min-h-[60px]">{state.prompt}</p>

        {!isGrila && state.responseType && (
          <div className="self-start text-[0.7rem] text-[#0c1a17] bg-[#6f9c99]/90 rounded-full px-2.5 py-1 font-bold tracking-wide">
            Răspuns: {state.responseType}
          </div>
        )}

        {isGrila ? (
          <div className="grid grid-cols-1 gap-2.5">
            {(state.options ?? []).map((opt, i) => {
              const isSel = selected === opt.id;
              let cls = "bg-[#050d0b] border-2 border-[#1e3a34] hover:border-[#6f9c99] hover:bg-[#0c1a17]";
              if (isSel && flash === "ok") cls = "bg-green-900/30 border-green-500/60 text-[#e2eeeb]";
              else if (isSel && flash === "bad") cls = "bg-red-900/30 border-red-500/60 text-[#e2eeeb]";
              else if (isSel) cls = "bg-[#0c1a17] border-[#6f9c99] text-[#e2eeeb]";
              else if (sent) cls = "bg-[#050d0b] border-[#16302b] opacity-60";
              return (
                <button
                  key={opt.id}
                  disabled={!canAnswer}
                  onClick={() => {
                    setSelected(opt.id);
                    void send({ selectedOptionId: opt.id });
                  }}
                  className={`${cls} rounded-xl text-left p-3.5 text-[0.95rem] cursor-pointer disabled:cursor-default transition-all`}
                >
                  <span className="font-cinzel text-[#6f9c99] mr-2">{String.fromCharCode(65 + i)}.</span>
                  {opt.text}
                </button>
              );
            })}
          </div>
        ) : (
          <div className="flex gap-2">
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && canAnswer && typed.trim() && void send({ answer: typed.trim() })}
              disabled={!canAnswer}
              inputMode="numeric"
              placeholder={state.responseType === "an" ? "ex: 1989" : "număr"}
              className="flex-1 bg-[#050d0b] border-2 border-[#1e3a34] rounded-xl p-3.5 text-[1rem] text-[#d3e3e1] placeholder-[#25443f] focus:border-[#6f9c99] outline-none disabled:opacity-60"
            />
            <button
              onClick={() => void send({ answer: typed.trim() })}
              disabled={!canAnswer || !typed.trim()}
              className={`${BTN_MAIN} px-6 disabled:opacity-50`}
            >
              Trimite
            </button>
          </div>
        )}

        <div className="text-center text-[0.8rem] min-h-[18px]">
          {sent ? (
            <span className="text-[#8fb0ac]">
              {flash === "ok" ? "✔ Răspuns corect — " : flash === "bad" ? "✖ Răspuns greșit — " : ""}
              {state.opponentAnswered ? "se încheie runda…" : "aștept adversarul…"}
            </span>
          ) : timeLeft === 0 ? (
            <span className="text-red-400">⏱ Timpul a expirat</span>
          ) : state.opponentAnswered ? (
            <span className="text-[#75938f]">adversarul a răspuns — grăbește-te!</span>
          ) : (
            <span className="text-[#25443f]">răspunde înainte să expire timpul</span>
          )}
        </div>
      </div>
    </div>
  );
}
