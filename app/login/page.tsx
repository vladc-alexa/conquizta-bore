"use client";

import { useState } from "react";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Autentificare eșuată.");
        return;
      }
      window.location.href = "/";
    } catch {
      setError("Eroare de rețea. Încearcă din nou.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-[80vh] w-full">
      <form
        onSubmit={submit}
        className="bg-gradient-to-br from-[#122420] to-[#0c1a17] border-2 border-[#1e3a34] rounded-2xl shadow-2xl w-full max-w-[380px] p-7 flex flex-col gap-4"
      >
        <p className="text-center text-[0.85rem] text-[#8fb0ac] -mt-2">Autentificare</p>

        <label className="flex flex-col gap-1.5 text-[0.8rem] text-[#8fb0ac]">
          Email
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="tu@exemplu.ro"
            autoComplete="email"
            className="bg-[#050d0b] border-2 border-[#1e3a34] rounded-lg text-[#9ec6c1] p-2.5 outline-none focus:border-[#6f9c99]"
          />
        </label>

        <label className="flex flex-col gap-1.5 text-[0.8rem] text-[#8fb0ac]">
          Parolă
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete="current-password"
            className="bg-[#050d0b] border-2 border-[#1e3a34] rounded-lg text-[#9ec6c1] p-2.5 outline-none focus:border-[#6f9c99]"
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
          {loading ? "Se autentifică…" : "Intră"}
        </button>

        <p className="text-center text-[0.78rem] text-[#75938f]">
          Nu ai cont?{" "}
          <a href="/register" className="text-[#9ec6c1] underline hover:text-[#d7e6e3]">
            Creează unul
          </a>
        </p>
      </form>
    </div>
  );
}
