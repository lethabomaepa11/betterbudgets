"use client";

import { useEffect, useState } from "react";

import { Logo } from "./logo";

const OPENING_DURATION_MS = 1200;

function wasHardReload() {
  if (typeof performance === "undefined") return false;

  const navigation = performance.getEntriesByType("navigation")[0] as
    | PerformanceNavigationTiming
    | undefined;
  if (navigation) return navigation.type === "reload";

  return (performance as Performance & { navigation?: { type?: number } }).navigation?.type === 1;
}

/**
 * A best-effort branded transition for the moments Next cannot animate itself:
 * a hard reload and a tab/window leaving the document.
 */
export default function PageTransitionGate() {
  const [opening, setOpening] = useState(false);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (!wasHardReload()) return;

    setOpening(true);
    const timer = window.setTimeout(() => setOpening(false), OPENING_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const handleLeave = () => {
      setLeaving(true);
      const overlay = document.getElementById("global-transition-overlay");
      overlay?.setAttribute("data-leaving", "true");
    };

    window.addEventListener("beforeunload", handleLeave);
    window.addEventListener("pagehide", handleLeave);
    return () => {
      window.removeEventListener("beforeunload", handleLeave);
      window.removeEventListener("pagehide", handleLeave);
    };
  }, []);

  const visible = opening || leaving;

  return (
    <div
      id="global-transition-overlay"
      aria-hidden="true"
      className={[
        "pointer-events-none fixed inset-0 z-[100] flex items-center justify-center",
        "bg-background/96 backdrop-blur-sm transition-opacity duration-300",
        visible ? "opacity-100" : "opacity-0",
        opening && "app-opening-transition",
        leaving && "app-closing-transition",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="flex flex-col items-center gap-4">
        <Logo
          size={72}
          priority
          className="motion-safe:animate-[logo-loader_1.4s_ease-in-out_infinite]"
        />
        <span className="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">
          betterbudgets
        </span>
      </div>
    </div>
  );
}
