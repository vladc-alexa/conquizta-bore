"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type State = "working" | "ok" | "error";

export default function VerifyEmailClient({ token }: { token: string }) {
  const [state, setState] = useState<State>(token ? "working" : "error");
  const [message, setMessage] = useState(token ? "" : "Linkul nu conține un cod de confirmare.");

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/auth/verify-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setState("error");
          setMessage(data.error || "Link invalid sau expirat.");
          return;
        }
        setState("ok");
        // the API already set the session cookie — drop the player straight into the arena
        setTimeout(() => {
          window.location.href = "/";
        }, 1200);
      } catch {
        if (!cancelled) {
          setState("error");
          setMessage("Eroare de rețea. Încearcă din nou.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <div className="arena-backdrop flex flex-col items-center justify-center min-h-screen w-full px-4 py-8">
      <div className="text-center mb-6 z-10 bg-[#120d19]/75 border border-[#b68635]/60 rounded-2xl px-8 py-3 shadow-xl">
        <h1 className="font-cinzel font-extrabold text-4xl sm:text-5xl tracking-[0.14em] gold-title leading-tight">
          ST0NE QUIZ
        </h1>
      </div>

      <div className="royal-panel rounded-2xl w-full max-w-[440px] p-7 sm:p-8 flex flex-col gap-5 z-10 text-center">
        {state === "working" && (
          <>
            <div className="text-4xl">⚔</div>
            <p className="text-[#d6be92] text-sm">Se confirmă adresa de email…</p>
          </>
        )}

        {state === "ok" && (
          <>
            <div className="text-4xl">🛡️</div>
            <p className="font-cinzel text-[#f3ca6b] tracking-[0.14em] uppercase text-sm">Email confirmat</p>
            <p className="text-[#d6be92] text-sm">Contul e activ. Te ducem în arenă…</p>
          </>
        )}

        {state === "error" && (
          <>
            <div className="text-4xl">⛔</div>
            <p className="font-cinzel text-[#f3ca6b] tracking-[0.14em] uppercase text-sm">Confirmare eșuată</p>
            <p className="text-[#d6be92] text-sm">{message}</p>
            <Link
              href="/login"
              className="btn-crimson rounded-xl font-cinzel font-bold tracking-[0.16em] text-sm uppercase py-3 px-4 cursor-pointer"
            >
              Cere un link nou
            </Link>
            <p className="text-[0.72rem] text-[#bfa576]">
              Intră în cont cu emailul și parola; dacă adresa nu e confirmată îți putem retrimite linkul de acolo.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
