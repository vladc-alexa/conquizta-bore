"use client";

import { useCallback, useEffect, useState } from "react";

interface AdminUser {
  id: string;
  displayName: string;
  email: string | null;
  isAdmin: boolean;
  isMuted: boolean;
  hideScore: boolean;
  canEditQuestions: boolean;
  createdAt: string;
}

interface AdminQuestion {
  id: string;
  prompt: string;
  isPublished: boolean;
  correctAnswer: string | null;
  options: { id: string; text: string; isCorrect: boolean }[];
  reportCount: number;
}

export default function AdminPage() {
  const [me, setMe] = useState<{ name: string; isAdmin: boolean; canEditQuestions: boolean } | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [busy, setBusy] = useState(false);
  const [questions, setQuestions] = useState<AdminQuestion[]>([]);
  const [qSearch, setQSearch] = useState("");
  const [qStatus, setQStatus] = useState<"reported" | "all" | "published" | "disabled">("reported");
  const [qLoading, setQLoading] = useState(false);
  const [editing, setEditing] = useState<AdminQuestion | null>(null);
  const [editType, setEditType] = useState<"rapide" | "grila">("grila");
  const [editPrompt, setEditPrompt] = useState("");
  const [editAnswer, setEditAnswer] = useState("");
  const [editOptions, setEditOptions] = useState<{ text: string; isCorrect: boolean }[]>([]);
  const [editBusy, setEditBusy] = useState(false);
  const [editMsg, setEditMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [impOpen, setImpOpen] = useState(false);
  const [impText, setImpText] = useState("");
  const [impBusy, setImpBusy] = useState(false);
  const [impPreview, setImpPreview] = useState<{
    total: number;
    importable: number;
    imported: number;
    grila: number;
    rapide: number;
    duplicates: number;
    invalidCount: number;
    invalid: { line: number; reason: string }[];
    encoding?: string;
  } | null>(null);
  const [impMsg, setImpMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [qCounts, setQCounts] = useState<{
    active: { total: number; grila: number; rapide: number; other: number };
    inactive: { total: number; grila: number; rapide: number; other: number };
  } | null>(null);
  const [impB64, setImpB64] = useState("");
  const [impFileName, setImpFileName] = useState("");

  const load = useCallback(async () => {
    const meRes = await fetch("/api/auth/me");
    if (!meRes.ok) {
      window.location.href = "/login";
      return;
    }
    const meData = await meRes.json();
    setMe(meData);
    if (!meData.isAdmin && !meData.canEditQuestions) return;
    if (!meData.isAdmin) return;
    const res = await fetch("/api/admin/users");
    if (res.ok) {
      const data = await res.json();
      setUsers(data.users ?? []);
    }
  }, []);

  const loadQuestions = useCallback(async (search = qSearch, status = qStatus) => {
    setQLoading(true);
    try {
      const res = await fetch(
        `/api/admin/questions?search=${encodeURIComponent(search)}&status=${status}&limit=100`
      );
      if (res.ok) {
        const data = await res.json();
        setQuestions(data.questions ?? []);
        if (data.counts) setQCounts(data.counts);
      }
    } catch {
      /* ignore */
    } finally {
      setQLoading(false);
    }
  }, [qSearch, qStatus]);

  const openImport = () => {
    setImpText("");
    setImpB64("");
    setImpFileName("");
    setImpPreview(null);
    setImpMsg(null);
    setImpOpen(true);
  };

  const onImportFile = async (file: File | null) => {
    if (!file) return;
    try {
      // read the RAW bytes: letting the browser decode as UTF-8 would turn a
      // Windows-1250 / ISO-8859-2 file's diacritics into "�" before upload
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let bin = "";
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      setImpB64(btoa(bin));
      setImpFileName(file.name);
      setImpText("");
      setImpPreview(null);
      setImpMsg(null);
    } catch {
      setImpMsg({ ok: false, text: "Nu am putut citi fișierul." });
    }
  };

  const runImport = async (dryRun: boolean) => {
    setImpBusy(true);
    setImpMsg(null);
    if (dryRun) setImpPreview(null);
    try {
      const res = await fetch("/api/admin/questions/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv: impText, csvBase64: impText.trim() ? "" : impB64, dryRun }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setImpMsg({ ok: false, text: data.error || "Eroare la import." });
        return;
      }
      setImpPreview(data);
      if (dryRun) {
        setImpMsg({
          ok: true,
          text: `Verificat: ${data.importable} de importat (${data.grila} grilă + ${data.rapide} rapidă), ${data.duplicates} duplicate, ${data.invalidCount} invalide.`,
        });
      } else {
        setImpMsg({
          ok: true,
          text: `Gata! Importate ${data.imported} întrebări (${data.grila} grilă + ${data.rapide} rapidă).${data.duplicates ? ` ${data.duplicates} duplicate sărite.` : ""}`,
        });
        setImpText("");
        setImpPreview(null);
        loadQuestions();
      }
    } catch {
      setImpMsg({ ok: false, text: "Eroare de rețea." });
    } finally {
      setImpBusy(false);
    }
  };

  const toggleQuestion = async (q: AdminQuestion) => {
    const res = await fetch(`/api/admin/questions/${q.id}/toggle`, { method: "POST" });
    if (res.ok) {
      const data = await res.json();
      setQuestions((list) => list.map((x) => (x.id === q.id ? { ...x, isPublished: data.isPublished } : x)));
    }
  };

  const openEdit = (q: AdminQuestion) => {
    setEditing(q);
    setEditPrompt(q.prompt);
    const isRapide = q.options.length === 1;
    setEditType(isRapide ? "rapide" : "grila");
    setEditAnswer((q.options.find((o) => o.isCorrect)?.text ?? q.options[0]?.text ?? "").trim());
    // grila: always exactly 4 variants; pad/truncate to 4, ensure one marked correct
    const opts = q.options.map((o) => ({ text: o.text, isCorrect: o.isCorrect }));
    if (opts.length > 0 && !opts.some((o) => o.isCorrect)) opts[0].isCorrect = true;
    while (opts.length < 4) opts.push({ text: "", isCorrect: false });
    setEditOptions(opts.slice(0, 4));
    setEditMsg(null);
  };

  const switchEditType = (t: "rapide" | "grila") => {
    setEditType(t);
    if (t === "rapide") {
      const correct = editOptions.find((o) => o.isCorrect)?.text ?? editOptions[0]?.text ?? "";
      setEditAnswer(correct.trim());
    } else {
      const opts = editAnswer.trim()
        ? [{ text: editAnswer.trim(), isCorrect: true }, { text: "", isCorrect: false }, { text: "", isCorrect: false }, { text: "", isCorrect: false }]
        : editOptions;
      setEditOptions(opts.length === 4 ? opts : [{ text: "", isCorrect: true }, { text: "", isCorrect: false }, { text: "", isCorrect: false }, { text: "", isCorrect: false }]);
    }
    setEditMsg(null);
  };

  const saveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    setEditBusy(true);
    setEditMsg(null);
    try {
      const body =
        editType === "rapide"
          ? { prompt: editPrompt, options: [{ text: editAnswer.trim(), isCorrect: true }] }
          : { prompt: editPrompt, options: editOptions };
      const res = await fetch(`/api/admin/questions/${editing.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setEditMsg({ ok: false, text: data.error || "Eroare." });
        return;
      }
      setEditing(null);
      loadQuestions();
    } catch {
      setEditMsg({ ok: false, text: "Eroare de rețea." });
    } finally {
      setEditBusy(false);
    }
  };

  useEffect(() => {
    load();
  }, [load]);

  // allow deep-linking into a specific question: /admin?search=<id-or-text>
  useEffect(() => {
    const s = new URLSearchParams(window.location.search).get("search");
    if (s) {
      setQSearch(s);
      setQStatus("all");
    }
  }, []);

  const canEdit = !!me && (me.isAdmin || me.canEditQuestions);

  useEffect(() => {
    if (canEdit) {
      const t = setTimeout(() => loadQuestions(), 300);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qSearch, qStatus, canEdit]);

  const toggleMute = async (u: AdminUser) => {
    const res = await fetch(`/api/admin/users/${u.id}/mute`, { method: "POST" });
    if (res.ok) {
      const data = await res.json();
      setUsers((list) => list.map((x) => (x.id === u.id ? { ...x, isMuted: data.isMuted } : x)));
    }
  };

  const toggleHideScore = async (u: AdminUser) => {
    const res = await fetch(`/api/admin/users/${u.id}/hide`, { method: "POST" });
    if (res.ok) {
      const data = await res.json();
      setUsers((list) => list.map((x) => (x.id === u.id ? { ...x, hideScore: data.hideScore } : x)));
    }
  };

  const toggleEditor = async (u: AdminUser) => {
    const res = await fetch(`/api/admin/users/${u.id}/editor`, { method: "POST" });
    if (res.ok) {
      const data = await res.json();
      setUsers((list) => list.map((x) => (x.id === u.id ? { ...x, canEditQuestions: data.canEditQuestions } : x)));
    }
  };

  const renameUser = async (u: AdminUser) => {
    const newName = window.prompt(`Nume nou pentru ${u.displayName}:`, u.displayName);
    if (!newName || newName.trim() === u.displayName) return;
    setError("");
    setOk("");
    const res = await fetch(`/api/admin/users/${u.id}/name`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim() }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error || "Eroare la redenumire.");
      return;
    }
    setOk(`Jucătorul ${u.displayName} a fost redenumit în ${data.name}.`);
    load();
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setOk("");
    setBusy(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: name, email: email || null, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Eroare la creare.");
        return;
      }
      setOk(`Jucătorul ${data.user.displayName} a fost adăugat.`);
      setName("");
      setEmail("");
      setPassword("");
      load();
    } catch {
      setError("Eroare de rețea.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (u: AdminUser) => {
    if (!confirm(`Ștergi jucătorul ${u.displayName}?`)) return;
    setError("");
    setOk("");
    const res = await fetch(`/api/admin/users?id=${u.id}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error || "Eroare la ștergere.");
      return;
    }
    setOk(`Jucătorul ${u.displayName} a fost șters.`);
    load();
  };

  if (me === null) {
    return <div className="text-center font-cinzel text-[#f5c97a] py-16">Se încarcă…</div>;
  }

  if (!me.isAdmin && !me.canEditQuestions) {
    return (
      <div className="text-center py-16">
        <div className="text-[2rem]">🚫</div>
        <div className="font-cinzel text-[#f5c97a] text-[1.2rem] mt-2">Acces interzis</div>
        <div className="text-[#c8a070] text-[0.85rem] mt-1">Doar administratorii și editorii pot vedea această pagină.</div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-3xl mx-auto flex flex-col gap-5 py-6">
      <div className="flex items-center justify-between">
        <h1 className="!mb-0 text-[1.3rem]">Admin — Jucători & Întrebări</h1>
        <a href="/" className="text-[#c8a070] hover:text-[#f5c97a] text-[0.8rem]">← Înapoi</a>
      </div>

      {me.isAdmin && (
        <>
      <form
        onSubmit={create}
        className="bg-gradient-to-br from-[#3d2510] to-[#2a1608] border-2 border-[#7a4e22] rounded-2xl shadow-2xl p-5 flex flex-col gap-3"
      >
        <h3 className="font-cinzel text-[#f5c97a] text-[0.9rem] tracking-widest">Adaugă jucător</h3>
        <div className="grid sm:grid-cols-3 gap-2.5">
          <input
            required
            maxLength={32}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nume jucător (max 32)"
            className="bg-[#1a0e05] border-2 border-[#7a4e22] rounded-lg text-[#f5c97a] p-2.5 outline-none focus:border-[#c87030]"
          />
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email (opțional)"
            className="bg-[#1a0e05] border-2 border-[#7a4e22] rounded-lg text-[#f5c97a] p-2.5 outline-none focus:border-[#c87030]"
          />
          <input
            required
            minLength={4}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Parolă (min 4)"
            className="bg-[#1a0e05] border-2 border-[#7a4e22] rounded-lg text-[#f5c97a] p-2.5 outline-none focus:border-[#c87030]"
          />
        </div>
        {error && <div className="text-red-400 text-[0.8rem]">{error}</div>}
        {ok && <div className="text-green-400 text-[0.8rem]">{ok}</div>}
        <button
          type="submit"
          disabled={busy}
          className="self-start bg-gradient-to-br from-[#c87030] to-[#7a4010] border-2 border-[#f5c97a60] rounded-lg text-[#f5e8c0] font-cinzel px-5 py-2.5 hover:brightness-110 disabled:opacity-50 cursor-pointer"
        >
          {busy ? "Se adaugă…" : "+ Adaugă"}
        </button>
      </form>

      <div className="bg-gradient-to-br from-[#3d2510] to-[#2a1608] border-2 border-[#7a4e22] rounded-2xl shadow-2xl p-5 flex flex-col gap-2">
        <h3 className="font-cinzel text-[#f5c97a] text-[0.9rem] tracking-widest">Jucători ({users.length})</h3>
        <div className="flex flex-col">
          {users.map((u) => (
            <div
              key={u.id}
              className="grid grid-cols-[1fr_auto_auto] gap-3 items-center text-[0.85rem] p-2 px-2.5 rounded odd:bg-white/5"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-cinzel text-[#f5c97a] truncate">{u.displayName}</span>
                {u.isAdmin && (
                  <span className="text-[0.65rem] text-[#2a1608] bg-[#f5c97a] rounded px-1.5 py-0.5 font-bold">ADMIN</span>
                )}
                {u.isMuted && (
                  <span className="text-[0.65rem] text-red-400 bg-red-900/30 border border-red-500/40 rounded px-1.5 py-0.5">🔇 MUTAT</span>
                )}
                {u.hideScore && (
                  <span className="text-[0.65rem] text-[#b57edc] bg-purple-900/30 border border-purple-500/40 rounded px-1.5 py-0.5">🔒 SCOR ASCUNS</span>
                )}
                {u.canEditQuestions && (
                  <span className="text-[0.65rem] text-[#f5c97a] bg-amber-900/30 border border-amber-500/40 rounded px-1.5 py-0.5">✏️ EDITOR</span>
                )}
              </div>
              <span className="text-[#c8a070] text-[0.75rem]">{u.email || "—"}</span>
              <div className="flex items-center gap-2">
                <span className="text-[#a07848] text-[0.7rem]">{new Date(u.createdAt).toLocaleDateString("ro-RO")}</span>
                <button
                  onClick={() => renameUser(u)}
                  className="text-[#c8a070] hover:text-[#f5c97a] text-[0.8rem] cursor-pointer"
                  title="Redenumește"
                >
                  ✏️
                </button>
                {!u.isAdmin && (
                  <>
                    <button
                      onClick={() => toggleEditor(u)}
                      className={`text-[0.7rem] border rounded px-1.5 py-0.5 cursor-pointer hover:brightness-110 ${
                        u.canEditQuestions
                          ? "text-[#f5c97a] border-amber-500/40 hover:bg-amber-900/30"
                          : "text-[#c8a070] border-[#7a4e22] hover:bg-[#3d2510]"
                      }`}
                      title={u.canEditQuestions ? "Revocă dreptul de editare" : "Dă drept de editare a întrebărilor"}
                    >
                      {u.canEditQuestions ? "Fără editare" : "Editor"}
                    </button>
                    <button
                      onClick={() => toggleHideScore(u)}
                      className={`text-[0.7rem] border rounded px-1.5 py-0.5 cursor-pointer hover:brightness-110 ${
                        u.hideScore
                          ? "text-[#b57edc] border-purple-500/40 hover:bg-purple-900/30"
                          : "text-[#c8a070] border-[#7a4e22] hover:bg-[#3d2510]"
                      }`}
                      title={u.hideScore ? "Arată scorul public" : "Ascunde scorul public"}
                    >
                      {u.hideScore ? "Arată scor" : "Ascunde scor"}
                    </button>
                    <button
                      onClick={() => toggleMute(u)}
                      className={`text-[0.7rem] border rounded px-1.5 py-0.5 cursor-pointer hover:brightness-110 ${
                        u.isMuted
                          ? "text-green-400 border-green-500/40 hover:bg-green-900/30"
                          : "text-[#c8a070] border-[#7a4e22] hover:bg-[#3d2510]"
                      }`}
                      title={u.isMuted ? "Dezmută" : "Mută"}
                    >
                      {u.isMuted ? "Dezmută" : "Mută"}
                    </button>
                    <button
                      onClick={() => remove(u)}
                      className="text-red-400/80 hover:text-red-300 text-[0.75rem] cursor-pointer"
                      title="Șterge"
                    >
                      ✕
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
      </>
      )}

      {/* questions browser */}
      <div className="bg-gradient-to-br from-[#3d2510] to-[#2a1608] border-2 border-[#7a4e22] rounded-2xl shadow-2xl p-5 flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h3 className="font-cinzel text-[#f5c97a] text-[0.9rem] tracking-widest">
            Întrebări {qLoading && <span className="text-[#a07848] text-[0.7rem]">(se încarcă…)</span>}
          </h3>
          <div className="flex gap-2">
            <button
              onClick={openImport}
              className="text-[0.75rem] border-2 border-[#7a4e22] rounded-lg px-3 py-2 text-[#c8a070] hover:bg-[#3d2510] cursor-pointer whitespace-nowrap"
              title="Importă întrebări din CSV (grilă sau rapidă)"
            >
              ⬆️ Importă
            </button>
            <input
              value={qSearch}
              onChange={(e) => setQSearch(e.target.value)}
              placeholder="Caută în întrebări…"
              className="bg-[#1a0e05] border-2 border-[#7a4e22] rounded-lg text-[#f5c97a] text-[0.8rem] p-2 w-52 outline-none focus:border-[#c87030]"
            />
            <select
              value={qStatus}
              onChange={(e) => setQStatus(e.target.value as typeof qStatus)}
              className="bg-[#1a0e05] border-2 border-[#7a4e22] rounded-lg text-[#f5c97a] text-[0.8rem] p-2 outline-none cursor-pointer"
            >
              <option value="reported">Raportate</option>
              <option value="all">Toate</option>
              <option value="published">Publicate</option>
              <option value="disabled">Dezactivate</option>
            </select>
        </div>
        {qCounts && (
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[0.75rem] border-t border-[#7a4e2250] pt-2.5">
            <span className="text-[#c8a070]">
              ✅ Active:{" "}
              <strong className="text-[#8ee08a] text-[0.85rem]">{qCounts.active.total}</strong>{" "}
              <span className="text-[#a07848]">
                — {qCounts.active.grila} grilă · {qCounts.active.rapide} rapidă
                {qCounts.active.other ? ` · ${qCounts.active.other} altele` : ""}
              </span>
            </span>
            <span className="text-[#c8a070]">
              ⛔ Inactive:{" "}
              <strong className="text-[#e0928a] text-[0.85rem]">{qCounts.inactive.total}</strong>{" "}
              <span className="text-[#a07848]">
                — {qCounts.inactive.grila} grilă · {qCounts.inactive.rapide} rapidă
                {qCounts.inactive.other ? ` · ${qCounts.inactive.other} altele` : ""}
              </span>
            </span>
            <span className="text-[#a07848]">
              total {qCounts.active.total + qCounts.inactive.total}
            </span>
          </div>
        )}
        </div>
        <div className="flex flex-col max-h-[420px] overflow-y-auto">
          {questions.length === 0 ? (
            <div className="text-[#a07848] text-[0.8rem] text-center p-4">
              {qStatus === "reported"
                ? "Nicio întrebare raportată — apar aici doar întrebările raportate de jucători."
                : "Nicio întrebare găsită."}
            </div>
          ) : (
            questions.map((q) => (
              <div
                key={q.id}
                className="grid grid-cols-[1fr_auto] gap-3 items-center text-[0.82rem] p-2 px-2.5 rounded odd:bg-white/5"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-[0.68rem] text-[#a07848]">ID {q.id.slice(0, 8)}</span>
                    {q.reportCount > 0 && (
                      <span className="text-[0.65rem] text-red-400 bg-red-900/30 border border-red-500/40 rounded px-1.5 py-0.5">
                        ⚠ {q.reportCount} raportări
                      </span>
                    )}
                    {q.isPublished ? (
                      <span className="text-[0.65rem] text-green-400 border border-green-500/40 rounded px-1.5 py-0.5">publicată</span>
                    ) : (
                      <span className="text-[0.65rem] text-[#a07848] border border-[#7a4e22] rounded px-1.5 py-0.5">dezactivată</span>
                    )}
                  </div>
                  <div className="text-[#e8d8b0] leading-snug mt-1">{q.prompt}</div>
                  <div className="text-[0.72rem] text-[#c8a070] mt-0.5">
                    Corect: <strong className="text-[#f5c97a]">{q.correctAnswer ?? "—"}</strong>
                  </div>
                </div>
                <div className="self-center flex items-center gap-2">
                  <button
                    onClick={() => openEdit(q)}
                    className="text-[0.72rem] border border-[#7a4e22] rounded-lg px-2.5 py-1.5 text-[#c8a070] hover:bg-[#3d2510] cursor-pointer"
                    title="Editează întrebarea"
                  >
                    ✏️ Editează
                  </button>
                  <button
                    onClick={() => toggleQuestion(q)}
                    className={`text-[0.72rem] border rounded-lg px-2.5 py-1.5 cursor-pointer hover:brightness-110 ${
                      q.isPublished
                        ? "text-red-400/90 border-red-500/40 hover:bg-red-900/30"
                        : "text-green-400 border-green-500/40 hover:bg-green-900/30"
                    }`}
                  >
                    {q.isPublished ? "Dezactivează" : "Activează"}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* import-questions modal */}
      {impOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="bg-gradient-to-br from-[#3d2510] to-[#2a1608] border-2 border-[#7a4e22] rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-5 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h3 className="font-cinzel text-[#f5c97a] text-[0.9rem] tracking-widest">⬆️ Importă întrebări (CSV)</h3>
              <button type="button" onClick={() => setImpOpen(false)} className="text-[#c8a070] hover:text-[#f5c97a] cursor-pointer">
                ✕
              </button>
            </div>
            <div className="text-[0.72rem] text-[#c8a070] leading-relaxed flex flex-col gap-0.5">
              <div>
                🎯 Grilă: <span className="font-mono text-[#e8d8b0]">întrebare;A;B;C;D;A</span> — ultima coloană = varianta corectă (A/B/C/D)
              </div>
              <div>
                ⚡ Rapidă: <span className="font-mono text-[#e8d8b0]">întrebare;răspuns</span> — răspuns numeric
              </div>
              <div>
                Separator <span className="font-mono">;</span> (merge și tab / virgulă). Se publică automat; duplicatele sunt sărite.
              </div>
            </div>
            <input
              type="file"
              accept=".csv,text/csv,text/plain"
              onChange={(e) => onImportFile(e.target.files?.[0] ?? null)}
              className="text-[0.75rem] text-[#c8a070] file:mr-3 file:bg-[#1a0e05] file:border-2 file:border-[#7a4e22] file:rounded-lg file:text-[#c8a070] file:px-3 file:py-1.5 file:cursor-pointer cursor-pointer"
            />
            <textarea
              value={impText}
              onChange={(e) => {
                setImpText(e.target.value);
                setImpB64("");
                setImpFileName("");
                setImpPreview(null);
              }}
              rows={10}
              placeholder={"Ce tehnica revolutionara de perspectiva...;Chiaroscuro;Sfumato;Tenebrism;Camaieu;B\nIn ce an a avut loc Marea Unire?;1918"}
              className="bg-[#1a0e05] border-2 border-[#7a4e22] rounded-lg text-[#e8d8b0] text-[0.78rem] p-2.5 outline-none focus:border-[#c87030] resize-y font-mono"
            />
            {impFileName && (
              <div className="text-[0.72rem] text-[#c8a070]">
                📄 {impFileName} — codificare detectată automat la verificare
                {impPreview?.encoding ? `: ${impPreview.encoding}` : ""}
              </div>
            )}
            {impPreview && (
              <div className="text-[0.75rem] text-[#e8d8b0] bg-[#1a0e05] border border-[#7a4e22] rounded-lg p-2.5 flex flex-col gap-1">
                <div>
                  De importat: <strong className="text-[#f5c97a]">{impPreview.importable}</strong> ({impPreview.grila} grilă +{" "}
                  {impPreview.rapide} rapidă)
                </div>
                <div className="text-[#c8a070]">
                  Duplicate sărite: {impPreview.duplicates} · Invalide: {impPreview.invalidCount} · Total linii: {impPreview.total}
                </div>
                {impPreview.invalid.length > 0 && (
                  <div className="mt-1 flex flex-col gap-0.5 text-[0.68rem] text-red-400/90">
                    {impPreview.invalid.map((iv, i) => (
                      <div key={i}>
                        linia {iv.line}: {iv.reason}
                      </div>
                    ))}
                    {impPreview.invalidCount > impPreview.invalid.length && (
                      <div>…și încă {impPreview.invalidCount - impPreview.invalid.length}</div>
                    )}
                  </div>
                )}
              </div>
            )}
            {impMsg && <div className={`text-[0.8rem] ${impMsg.ok ? "text-green-400" : "text-red-400"}`}>{impMsg.text}</div>}
            <div className="flex gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => runImport(true)}
                disabled={impBusy || (!impText.trim() && !impB64)}
                className="bg-[#1a0e05] border-2 border-[#7a4e22] rounded-lg text-[#c8a070] px-4 py-2 hover:bg-[#3d2510] disabled:opacity-50 cursor-pointer"
              >
                🔍 Verifică
              </button>
              <button
                type="button"
                onClick={() => runImport(false)}
                disabled={impBusy || !impPreview || impPreview.importable === 0}
                className="bg-gradient-to-br from-[#c87030] to-[#7a4010] border-2 border-[#f5c97a60] rounded-lg text-[#f5e8c0] font-cinzel px-5 py-2 hover:brightness-110 disabled:opacity-50 cursor-pointer"
              >
                {impBusy ? "Se importă…" : `⬆️ Importă${impPreview ? " " + impPreview.importable : ""}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* edit-question modal */}
      {editing && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <form
            onSubmit={saveEdit}
            className="bg-gradient-to-br from-[#3d2510] to-[#2a1608] border-2 border-[#7a4e22] rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-5 flex flex-col gap-3"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-cinzel text-[#f5c97a] text-[0.9rem] tracking-widest">✏️ Editează întrebarea</h3>
              <button type="button" onClick={() => setEditing(null)} className="text-[#c8a070] hover:text-[#f5c97a] cursor-pointer">
                ✕
              </button>
            </div>
            <div className="text-[0.68rem] font-mono text-[#a07848]">ID {editing.id}</div>
            <textarea
              required
              maxLength={1000}
              rows={3}
              value={editPrompt}
              onChange={(e) => setEditPrompt(e.target.value)}
              className="bg-[#1a0e05] border-2 border-[#7a4e22] rounded-lg text-[#e8d8b0] p-2.5 outline-none focus:border-[#c87030] resize-y"
            />
            <div className="flex gap-4">
              <label className="flex items-center gap-1.5 text-[0.8rem] text-[#c8a070] cursor-pointer">
                <input
                  type="radio"
                  name="qtype"
                  checked={editType === "rapide"}
                  onChange={() => switchEditType("rapide")}
                  className="accent-[#c87030] cursor-pointer"
                />
                ⚡ Rapide (răspuns numeric)
              </label>
              <label className="flex items-center gap-1.5 text-[0.8rem] text-[#c8a070] cursor-pointer">
                <input
                  type="radio"
                  name="qtype"
                  checked={editType === "grila"}
                  onChange={() => switchEditType("grila")}
                  className="accent-[#c87030] cursor-pointer"
                />
                🎯 Grilă (4 variante)
              </label>
            </div>
            {editType === "rapide" ? (
              <div className="flex flex-col gap-1.5">
                <div className="text-[0.75rem] text-[#c8a070]">
                  Răspunsul corect (număr între -500 și 10.000.000):
                </div>
                <input
                  value={editAnswer}
                  onChange={(e) => setEditAnswer(e.target.value.replace(/[^0-9-]/g, ""))}
                  inputMode="numeric"
                  placeholder="ex: 50"
                  className="bg-[#1a0e05] border-2 border-[#7a4e22] rounded-lg text-[#f5c97a] p-2 outline-none focus:border-[#c87030]"
                />
              </div>
            ) : (
              <>
                <div className="text-[0.75rem] text-[#c8a070]">Exact 4 variante — marchează-o pe cea corectă:</div>
                <div className="flex flex-col gap-1.5">
                  {editOptions.map((o, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="correct-option"
                        checked={o.isCorrect}
                        onChange={() => setEditOptions((opts) => opts.map((x, j) => ({ ...x, isCorrect: j === i })))}
                        title="Corectă"
                        className="accent-[#c87030] cursor-pointer shrink-0"
                      />
                      <input
                        value={o.text}
                        onChange={(e) => setEditOptions((opts) => opts.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))}
                        maxLength={500}
                        placeholder={`Varianta ${i + 1}`}
                        className="flex-1 bg-[#1a0e05] border-2 border-[#7a4e22] rounded-lg text-[#e8d8b0] p-2 outline-none focus:border-[#c87030]"
                      />
                    </div>
                  ))}
                </div>
              </>
            )}
            {editMsg && (
              <div className={`text-[0.8rem] ${editMsg.ok ? "text-green-400" : "text-red-400"}`}>{editMsg.text}</div>
            )}
            <button
              type="submit"
              disabled={editBusy}
              className="self-start bg-gradient-to-br from-[#c87030] to-[#7a4010] border-2 border-[#f5c97a60] rounded-lg text-[#f5e8c0] font-cinzel px-5 py-2 hover:brightness-110 disabled:opacity-50 cursor-pointer"
            >
              {editBusy ? "Se salvează…" : "Salvează"}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
