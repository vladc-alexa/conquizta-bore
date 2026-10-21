"use client";

// "I'm still here" heartbeat. Mounted once in the root layout, so every page
// (dashboard, train, duel, tower, leaderboard) keeps the player on the online
// list while the tab is open. Silent when logged out (the API just 401s) and
// paused while the tab is hidden — a background tab is not "online".
import { useEffect } from "react";
import { HEARTBEAT_MS } from "@/lib/presence";

export default function PresenceBeacon() {
  useEffect(() => {
    let stopped = false;

    const beat = async () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      try {
        await fetch("/api/presence", { method: "POST", cache: "no-store" });
      } catch {
        /* offline or logged out — the next beat will retry */
      }
    };

    const onVisible = () => {
      if (!stopped && document.visibilityState === "visible") beat();
    };

    beat();
    const timer = setInterval(beat, HEARTBEAT_MS);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return null;
}
