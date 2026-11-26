"use client";

// Invitations a player receives: "X te invită la Turnul / masa lui" with
// Accept / Refuz. Polled globally (dashboard + every game screen) so an invite
// finds you mid-round; accepting walks you straight to that table.
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Invite = {
  id: string;
  kind: "tower" | "carciuma";
  gameId: string;
  fromName: string;
  seats: number;
  seated: number;
  players: string[];
};

export default function InvitesCenter() {
  const router = useRouter();
  const [invites, setInvites] = useState<Invite[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/invites", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setInvites(
        (data.invites ?? []).map((i: Invite & { kind: string }) => ({
          ...i,
          kind: i.kind === "carciuma" ? "carciuma" : "tower",
        }))
      );
    } catch {
      /* offline: keep what we have */
    }
  }, []);

  useEffect(() => {
    load();
    const t = window.setInterval(load, 5000);
    return () => window.clearInterval(t);
  }, [load]);

  const accept = async (inv: Invite) => {
    setBusy(inv.id);
    setErr("");
    try {
      const res = await fetch(`/api/invites/${inv.id}/accept`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(data.error || "nu am putut intra");
        setInvites((prev) => prev.filter((i) => i.id !== inv.id));
        return;
      }
      setInvites((prev) => prev.filter((i) => i.id !== inv.id));
      router.push(data.href || `/${inv.kind}/${inv.gameId}`);
    } catch {
      setErr("eroare de rețea");
    } finally {
      setBusy(null);
    }
  };

  const decline = async (inv: Invite) => {
    setBusy(inv.id);
    setInvites((prev) => prev.filter((i) => i.id !== inv.id));
    try {
      await fetch(`/api/invites/${inv.id}/decline`, { method: "POST" });
    } catch {
      /* it expires on its own */
    } finally {
      setBusy(null);
    }
  };

  if (!invites.length && !err) return null;

  return (
    <div className="fixed left-3 z-[70] flex w-[min(320px,calc(100vw-1.5rem))] flex-col gap-2 bottom-[calc(5.5rem+env(safe-area-inset-bottom))]">
      {invites.map((inv) => (
        <div
          key={inv.id}
          className="rounded-xl border-2 border-[#e8c46a]/60 bg-[#12140f]/95 px-3 py-2 shadow-2xl backdrop-blur"
          role="alertdialog"
          aria-label={`Invitație de la ${inv.fromName}`}
        >
          <p className="text-[0.62rem] uppercase tracking-wider text-[#e8c46a]">
            {inv.kind === "tower" ? "invitație la turn" : "invitație la cârciumă"}
          </p>
          <p className="text-[0.85rem] text-[#eae4cf]">
            <span className="font-semibold">{inv.fromName}</span> te cheamă la masă
          </p>
          <p className="truncate text-[0.7rem] text-[#9fb3a6]">
            {inv.players.join(", ") || "singur la masă"} · {inv.seated}/{inv.seats}
          </p>
          <div className="mt-1.5 flex gap-1.5">
            <button
              onClick={() => accept(inv)}
              disabled={busy !== null}
              className="flex-1 rounded-lg bg-gradient-to-br from-[#d9a441] to-[#7d5a1c] px-3 py-1.5 font-cinzel text-[0.78rem] text-[#10201b] disabled:opacity-40 cursor-pointer"
            >
              {busy === inv.id ? "Intru…" : "Intră"}
            </button>
            <button
              onClick={() => decline(inv)}
              disabled={busy !== null}
              className="rounded-lg border border-[#3b4a41] px-3 py-1.5 text-[0.78rem] text-[#a9bdb9] disabled:opacity-40 cursor-pointer"
            >
              Nu
            </button>
          </div>
        </div>
      ))}
      {err && <div className="rounded-lg border border-[#7a3a2a] bg-[#2a1310]/95 px-3 py-1.5 text-[0.75rem] text-[#f2b7a4]">{err}</div>}
    </div>
  );
}
