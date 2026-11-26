"use client";

import { useState } from "react";
import { LanguageSwitcher, useI18n } from "@/lib/i18n";

export default function LoginPage() {
  const { t } = useI18n();
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
        setError(data.error || t("loginFailed"));
        return;
      }
      window.location.href = "/";
    } catch {
      setError(t("loginNetError"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="arena-backdrop flex flex-col items-center justify-center min-h-screen w-full px-4 py-8">
      {/* Top right language switcher */}
      <div className="fixed top-4 right-4 z-20">
        <LanguageSwitcher />
      </div>

      {/* Royal Crest Header (clean Stone Quiz title, no tagline) */}
      <div className="text-center mb-6 z-10 bg-[#120d19]/75 border border-[#b68635]/60 rounded-2xl px-8 py-3 shadow-xl">
        <h1 className="font-cinzel font-extrabold text-4xl sm:text-5xl tracking-[0.14em] gold-title leading-tight">
          {t("brandTitle")}
        </h1>
      </div>

      {/* Ornate Login Citadel Card */}
      <form
        onSubmit={submit}
        className="royal-panel rounded-2xl w-full max-w-[420px] p-7 sm:p-8 flex flex-col gap-5 z-10"
      >
        {/* Decorative top corner rivets */}
        <div className="flex items-center justify-center gap-3">
          <div className="h-[1px] flex-1 bg-gradient-to-r from-transparent to-[#d4a147]" />
          <span className="font-cinzel text-[#f3ca6b] text-sm tracking-[0.2em] uppercase">
            {t("loginSubtitle")}
          </span>
          <div className="h-[1px] flex-1 bg-gradient-to-l from-transparent to-[#d4a147]" />
        </div>

        <label className="flex flex-col gap-1.5 text-xs font-cinzel tracking-wider text-[#d9bc84] uppercase">
          {t("loginEmail")}
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t("loginEmailPlaceholder")}
            autoComplete="email"
            className="bg-[#0d0a12]/90 border-2 border-[#7e5b27] rounded-xl text-[#fcecc4] font-sans text-sm px-3.5 py-2.5 outline-none focus:border-[#f0c05a] transition-colors"
          />
        </label>

        <label className="flex flex-col gap-1.5 text-xs font-cinzel tracking-wider text-[#d9bc84] uppercase">
          {t("loginPassword")}
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete="current-password"
            className="bg-[#0d0a12]/90 border-2 border-[#7e5b27] rounded-xl text-[#fcecc4] font-sans text-sm px-3.5 py-2.5 outline-none focus:border-[#f0c05a] transition-colors"
          />
        </label>

        {error && (
          <div className="text-red-300 text-xs bg-red-950/70 border border-red-500/50 rounded-xl p-3 text-center">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="btn-crimson rounded-xl font-cinzel font-bold tracking-[0.16em] text-sm uppercase py-3.5 cursor-pointer disabled:opacity-50"
        >
          ⚔ {loading ? t("loginLoading") : t("loginSubmit")}
        </button>

        <div className="text-center text-[0.72rem] text-[#bfa576] bg-[#0e0b14]/70 border border-[#6e4e20]/40 rounded-lg py-2 px-3">
          {t("loginDemoHint")}
        </div>
      </form>
    </div>
  );
}
