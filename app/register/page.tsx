"use client";

import { useState } from "react";
import Link from "next/link";
import Brand from "@/components/Brand";

export default function RegisterPage() {
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (displayName.trim().length < 3) {
      setError("Numele trebuie să aibă minim 3 caractere.");
      return;
    }
    if (password.length < 6) {
      setError("Parola trebuie să aibă minim 6 caractere.");
      return;
    }
    if (password !== confirm) {
      setError("Parolele nu coincid.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: displayName.trim(), email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Înregistrare eșuată.");
        return;
      }
      window.location.href = "/";
    } catch {
      setError("Eroare de rețea. Încearcă din nou.");
    } finally {
      setLoading(false);
    }
  };

  const inputCls =
    "bg-[#050d0b] border-2 border-[#1e3a34] rounded-lg text-[#9ec6c1] p-2.5 outline-none focus:border-[#6f9c99]";
  const labelCls = "flex flex-col gap-1.5 text-[0.8rem] text-[#8fb0ac]";

  return (
    <div className="flex items-center justify-center min-h-[80vh] w-full">
      <form
        onSubmit={submit}
        className="bg-gradient-to-br from-[#122420] to-[#0c1a17] border-2 border-[#1e3a34] rounded-2xl shadow-2xl w-full max-w-[380px] p-7 flex flex-col gap-4"
      >
        <div className="flex justify-center">
          <Brand size={30} />
        </div>
        <p className="text-center text-[0.85rem] text-[#8fb0ac] -mt-2">Cont nou</p>

        <label className={labelCls}>
          Nume de jucător
          <input
            type="text"
            required
            minLength={3}
            maxLength={32}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Numele din clasament"
            autoComplete="nickname"
            className={inputCls}
          />
        </label>

        <label className={labelCls}>
          Email
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="tu@exemplu.ro"
            autoComplete="email"
            className={inputCls}
          />
        </label>

        <label className={labelCls}>
          Parolă
          <input
            type="password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="minim 6 caractere"
            autoComplete="new-password"
            className={inputCls}
          />
        </label>

        <label className={labelCls}>
          Confirmă parola
          <input
            type="password"
            required
            minLength={6}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="••••••••"
            autoComplete="new-password"
            className={inputCls}
          />
        </label>

        {error && (
          <div className="text-red-400 text-[0.8rem] bg-red-900/20 border border-red-500/40 rounded-lg p-2.5 text-center">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="bg-gradient-to-br from-[#6f9c99] to-[#2c514c] border-2 border-[#9ec6c160] rounded-lg text-[#e2eeeb] font-cinzel p-3 hover:brightness-110 active:translate-y-px disabled:opacity-50 cursor-pointer"
        >
          {loading ? "Se creează contul…" : "Creează cont"}
        </button>

        <p className="text-center text-[0.78rem] text-[#75938f]">
          Ai deja cont?{" "}
          <Link href="/login" className="text-[#9ec6c1] underline hover:text-[#d7e6e3]">
            Intră
          </Link>
        </p>
      </form>
    </div>
  );
}
