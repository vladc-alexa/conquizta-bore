"use client";

// Keyboard answering for the four game screens: 1..4 pick the grilă options,
// and the numeric box keeps focus on every new rapidă so nobody has to click
// into it.
import { useEffect, useRef } from "react";

/**
 * Digit keys pick options (1 = first). Pass `null` when the player cannot answer
 * right now; passing a function always uses the latest render's closure, so it
 * is safe to call this hook before the component's early returns.
 */
export function useNumberKeys(onPick: ((index: number) => void) | null, max = 4) {
  const cb = useRef(onPick);
  useEffect(() => {
    cb.current = onPick;
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!cb.current) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el?.isContentEditable) return;
      if (e.key.length !== 1) return;
      const n = e.key.charCodeAt(0) - 48;
      if (n < 1 || n > max) return;
      e.preventDefault();
      cb.current(n - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [max]);
}

/**
 * Keep an input focused while it is the answer surface. `token` should change
 * with every new question (its id), so focus is re-applied per question.
 */
export function useAutoFocus<T extends HTMLElement>(active: boolean, token: unknown) {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    if (!active) return;
    const t = setTimeout(() => {
      const el = ref.current;
      if (!el) return;
      el.focus({ preventScroll: true });
      if (el instanceof HTMLInputElement && el.setSelectionRange) {
        const n = el.value.length;
        el.setSelectionRange(n, n);
      }
    }, 40);
    return () => clearTimeout(t);
  }, [active, token]);
  return ref;
}
