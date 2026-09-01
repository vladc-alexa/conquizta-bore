"use client";

import { useCallback, useEffect, useState } from "react";

interface AdminUser {
  id: string;
  displayName: string;
  email: string | null;
  isAdmin: boolean;
  createdAt: string;
}

export default function AdminPage() {
  const [me, setMe] = useState<{ name: string; isAdmin: boolean } | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const meRes = await fetch("/api/auth/me");
    if (!meRes.ok) {
      window.location.href = "/login";
      return;
    }
    const meData = await meRes.json();
    setMe(meData);
    if (!meData.isAdmin) return;
    const res = await fetch("/api/admin/users");
    if (res.ok) {
      const data = await res.json();
      setUsers(data.users ?? []);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

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

  if (!me.isAdmin) {
    return (
      <div className="text-center py-16">
        <div className="text-[2rem]">🚫</div>
        <div className="font-cinzel text-[#f5c97a] text-[1.2rem] mt-2">Acces interzis</div>
        <div className="text-[#c8a070] text-[0.85rem] mt-1">Doar administratorii pot vedea această pagină.</div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-3xl mx-auto flex flex-col gap-5 py-6">
      <div className="flex items-center justify-between">
        <h1 className="!mb-0 text-[1.3rem]">Admin — Jucători</h1>
        <a href="/" className="text-[#c8a070] hover:text-[#f5c97a] text-[0.8rem]">← Înapoi</a>
      </div>

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
              </div>
              <span className="text-[#c8a070] text-[0.75rem]">{u.email || "—"}</span>
              <div className="flex items-center gap-2">
                <span className="text-[#a07848] text-[0.7rem]">{new Date(u.createdAt).toLocaleDateString("ro-RO")}</span>
                {!u.isAdmin && (
                  <button
                    onClick={() => remove(u)}
                    className="text-red-400/80 hover:text-red-300 text-[0.75rem] cursor-pointer"
                    title="Șterge"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
