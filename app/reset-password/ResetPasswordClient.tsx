"use client";

import { useState } from "react";
import Link from "next/link";

export default function ResetPasswordClient({ token }: { token: string }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (password !== confirm) {
      setError("Parolele nu coincid.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Nu am putut schimba parola.");
        setLoading(false);
        return;
      }
      window.location.href = "/";
    } catch {
      setError("Eroare de rețea. Încearcă din nou.");
      setLoading(false);
    }
  };

  return (
    <div className="arena-backdrop flex flex-col items-center justify-center min-h-screen w-full px-4 py-8">
      <div className="text-center mb-6 z-10 bg-[#120d19]/75 border border-[#b68635]/60 rounded-2xl px-8 py-3 shadow-xl">
        <h1 className="font-cinzel font-extrabold text-4xl sm:text-5xl tracking-[0.14em] gold-title leading-tight">
          ST0NE QUIZ
        </h1>
      </div>

      {!token ? (
        <div className="royal-panel rounded-2xl w-full max-w-[420px] p-7 text-center flex flex-col gap-4 z-10">
          <p className="text-sm text-[#d6be92]">Linkul nu conține un cod de resetare.</p>
          <Link href="/forgot-password" className="text-xs text-[#ffe28a] underline hover:text-white">
            Cere un link nou
          </Link>
        </div>
      ) : (
        <form onSubmit={submit} className="royal-panel rounded-2xl w-full max-w-[420px] p-7 sm:p-8 flex flex-col gap-5 z-10">
          <p className="text-center font-cinzel text-[#f3ca6b] text-sm tracking-[0.2em] uppercase">Parolă nouă</p>

          <label className="flex flex-col gap-1.5 text-xs font-cinzel tracking-wider text-[#d9bc84] uppercase">
            Parolă nouă
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              className="bg-[#0d0a12]/90 border-2 border-[#7e5b27] rounded-xl text-[#fcecc4] font-sans text-sm px-3.5 py-2.5 outline-none focus:border-[#f0c05a]"
            />
          </label>

          <label className="flex flex-col gap-1.5 text-xs font-cinzel tracking-wider text-[#d9bc84] uppercase">
            Repetă parola
            <input
              type="password"
              required
              minLength={6}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              className="bg-[#0d0a12]/90 border-2 border-[#7e5b27] rounded-xl text-[#fcecc4] font-sans text-sm px-3.5 py-2.5 outline-none focus:border-[#f0c05a]"
            />
          </label>

          {error && (
            <div className="text-xs text-[#ffb3b3] bg-[#8a1f1f]/40 border border-[#b54b4b]/60 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="btn-crimson rounded-xl font-cinzel font-bold tracking-[0.16em] text-sm uppercase py-3.5 cursor-pointer disabled:opacity-50"
          >
            {loading ? "Se salvează…" : "Setează parola"}
          </button>
        </form>
      )}
    </div>
  );
}
