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
        className="bg-gradient-to-br from-[#3d2510] to-[#2a1608] border-2 border-[#7a4e22] rounded-2xl shadow-2xl w-full max-w-[380px] p-7 flex flex-col gap-4"
      >
        <h1 className="text-center !mb-1">MAHALADOR</h1>
        <p className="text-center text-[0.85rem] text-[#c8a070] -mt-2">Autentificare</p>

        <label className="flex flex-col gap-1.5 text-[0.8rem] text-[#c8a070]">
          Email
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="tu@exemplu.ro"
            autoComplete="email"
            className="bg-[#1a0e05] border-2 border-[#7a4e22] rounded-lg text-[#f5c97a] p-2.5 outline-none focus:border-[#c87030]"
          />
        </label>

        <label className="flex flex-col gap-1.5 text-[0.8rem] text-[#c8a070]">
          Parolă
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete="current-password"
            className="bg-[#1a0e05] border-2 border-[#7a4e22] rounded-lg text-[#f5c97a] p-2.5 outline-none focus:border-[#c87030]"
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
          className="bg-gradient-to-br from-[#c87030] to-[#7a4010] border-2 border-[#f5c97a60] rounded-lg text-[#f5e8c0] font-cinzel p-3 hover:brightness-110 active:translate-y-px disabled:opacity-50 cursor-pointer"
        >
          {loading ? "Se autentifică…" : "Intră"}
        </button>
      </form>
    </div>
  );
}
