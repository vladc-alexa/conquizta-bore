"use client";

// PROTOTYPE (dev only): facial expressions + a thrown rock on the tower board.
// Renders two climbers on the real board art at real size, cycles the thrower's
// expressions and lets you throw a rock that arcs onto the victim.
import { useCallback, useEffect, useRef, useState } from "react";
import { CLIMB_GROUND, LADDER_X } from "./towerSprites";

const THROWER = 0;
const VICTIM = 3;
const FACES = ["neutral", "tongue", "frown", "yawn"];

export default function TowerReactions() {
  const board = useRef<HTMLDivElement | null>(null);
  const throwerEl = useRef<HTMLDivElement | null>(null);
  const victimEl = useRef<HTMLDivElement | null>(null);
  const rockEl = useRef<HTMLDivElement | null>(null);
  const [face, setFace] = useState(0);
  const [arm, setArm] = useState<"idle" | "throw">("idle");
  const [hit, setHit] = useState(false);
  const [note, setNote] = useState("gata");

  useEffect(() => {
    const t = setInterval(() => setFace((f) => (f + 1) % FACES.length), 2200);
    return () => clearInterval(t);
  }, []);

  const throwRock = useCallback(() => {
    const b = board.current?.getBoundingClientRect();
    const from = throwerEl.current?.getBoundingClientRect();
    const to = victimEl.current?.getBoundingClientRect();
    const rock = rockEl.current;
    if (!b || !from || !to || !rock || arm === "throw") return;
    setNote("aruncă!");
    setArm("throw");
    const x0 = from.left - b.left + from.width / 2;
    const y0 = from.top - b.top + from.height * 0.3;
    const x1 = to.left - b.left + to.width / 2;
    const y1 = to.top - b.top + to.height * 0.4;
    const t0 = performance.now();
    const DUR = 620;
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / DUR);
      const x = x0 + (x1 - x0) * p;
      const y = y0 + (y1 - y0) * p - Math.sin(Math.PI * p) * 110;
      rock.style.transform = `translate(${x}px, ${y}px) rotate(${p * 720}deg)`;
      rock.style.opacity = "1";
      if (p < 1) {
        requestAnimationFrame(step);
        return;
      }
      rock.style.opacity = "0";
      setHit(true);
      setArm("idle");
      setNote("lovit!");
      setTimeout(() => setHit(false), 750);
    };
    requestAnimationFrame(step);
  }, [arm]);

  return (
    <div className="mt-6">
      <div className="mb-2 flex items-center gap-3">
        <h2 className="font-cinzel text-[0.78rem] tracking-widest text-[#9ec6c1]">
          PROTOTIP · EXPRESII + PIATRĂ ({note})
        </h2>
        <button
          type="button"
          onClick={throwRock}
          className="rounded-lg border-2 border-[#1e3a34] bg-[#12302a] px-3 py-1 text-[0.72rem] text-[#9ec6c1] hover:border-[#6f9c99]"
        >
          Aruncă piatra
        </button>
      </div>
      <div
        ref={board}
        className="relative w-full overflow-hidden rounded-xl border-2 border-[#1e3a34]"
        style={{ aspectRatio: "1024 / 572", containerType: "size" }}
      >
        <img src="/tower/tower.jpg" alt="" className="absolute inset-0 h-full w-full object-fill" />
        <div ref={rockEl} className="rock" />
        {/* victim */}
        <div
          ref={victimEl}
          className={`absolute -translate-x-1/2 ${hit ? "victim-hit" : ""}`}
          style={{ left: `${LADDER_X[VICTIM] * 100}%`, bottom: `${CLIMB_GROUND * 100}%` }}
        >
          <img
            src={hit ? "/tower/players/k_frown.png" : "/tower/players/k_neutral.png"}
            alt=""
            style={{ height: "13cqh" }}
            className="block"
          />
        </div>
        {/* thrower */}
        <div
          ref={throwerEl}
          className="absolute -translate-x-1/2"
          style={{ left: `${LADDER_X[THROWER] * 100}%`, bottom: `${CLIMB_GROUND * 100}%` }}
        >
          <img
            src={`/tower/players/k_${arm === "throw" ? "throw" : FACES[face]}.png`}
            alt=""
            style={{ height: "13cqh" }}
            className="block"
          />
        </div>
      </div>
      <p className="mt-2 text-[0.72rem] text-[#75938f]">
        sus: Cavalerul (aruncător, expresii ciclice) · mijloc: victima · piatra zboară pe arc
      </p>
    </div>
  );
}

