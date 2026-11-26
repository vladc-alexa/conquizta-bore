"use client";

import { useState } from "react";
import Link from "next/link";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
    } catch {
      /* same answer regardless — no account enumeration */
    } finally {
      setLoading(false);
      setSent(true);
    }
  };

  return (
    <div className="arena-backdrop flex flex-col items-center justify-center min-h-screen w-full px-4 py-8">
      <div className="text-center mb-6 z-10 bg-[#120d19]/75 border border-[#b68635]/60 rounded-2xl px-8 py-3 shadow-xl">
        <h1 className="font-cinzel font-extrabold text-4xl sm:text-5xl tracking-[0.14em] gold-title leading-tight">
          ST0NE QUIZ
        </h1>
      </div>

      <form onSubmit={submit} className="royal-panel rounded-2xl w-full max-w-[420px] p-7 sm:p-8 flex flex-col gap-5 z-10">
        <p className="text-center font-cinzel text-[#f3ca6b] text-sm tracking-[0.2em] uppercase">Resetare parolă</p>

        {sent ? (
          <>
            <p className="text-center text-sm text-[#d6be92]">
              Dacă există un cont cu <span className="text-[#ffe28a]">{email}</span>, ai primit un link de resetare.
              Verifică inboxul și folderul spam.
            </p>
            <Link href="/login" className="text-center text-xs text-[#ffe28a] underline hover:text-white">
              Înapoi la login
            </Link>
          </>
        ) : (
          <>
            <label className="flex flex-col gap-1.5 text-xs font-cinzel tracking-wider text-[#d9bc84] uppercase">
              Email
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="tu@exemplu.ro"
                autoComplete="email"
                className="bg-[#0d0a12]/90 border-2 border-[#7e5b27] rounded-xl text-[#fcecc4] font-sans text-sm px-3.5 py-2.5 outline-none focus:border-[#f0c05a]"
              />
            </label>
            <button
              type="submit"
              disabled={loading}
              className="btn-crimson rounded-xl font-cinzel font-bold tracking-[0.16em] text-sm uppercase py-3.5 cursor-pointer disabled:opacity-50"
            >
              {loading ? "Se trimite…" : "Trimite linkul"}
            </button>
            <Link href="/login" className="text-center text-xs text-[#d6be92] underline hover:text-white">
              Înapoi la login
            </Link>
          </>
        )}
      </form>
    </div>
  );
}
