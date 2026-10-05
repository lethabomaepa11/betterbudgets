"use client";

import type { Route } from "next";
import { cn } from "@betterbudgets/ui/lib/utils";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Plus, Settings } from "lucide-react";

import { useVault } from "@/lib/local-db/vault";

import { isActivePath, NAV_CENTER, NAV_ITEMS } from "./nav-items";

type NavSlot = { href: Route; label: string; Icon: typeof Home };

/**
 * Thumb-reachable tab bar, shown only below `md`. The desktop header carries the
 * same items inline, so this is pure addition rather than a second navigation
 * model to keep in sync.
 *
 * Only rendered while the vault is unlocked: a locked or un-onboarded device has
 * no ledger to navigate, and a bar leading nowhere is worse than no bar.
 */
export default function BottomNav() {
  const pathname = usePathname();
  const { status } = useVault();

  if (status !== "unlocked") return null;

  function tab(
    entry: (typeof NAV_ITEMS)[number],
    side: "left" | "right",
  ) {
    const active = isActivePath(pathname, entry.href);
    // Short labels keep the bar legible at phone widths; the full name stays in
    // the aria-label so a screen reader is unaffected.
    const label = side === "right" ? entry.label.slice(0, 3) : entry.label;

    return (
      <li key={entry.href} className="flex-1">
        <Link
          href={entry.href as Route}
          aria-current={active ? "page" : undefined}
          aria-label={entry.label}
          className={cn(
            "flex min-h-12 flex-col items-center justify-center gap-1 rounded-2xl px-1 py-1.5",
            "text-[11px] font-medium transition-colors",
            active
              ? "text-primary"
              : "text-muted-foreground hover:text-foreground active:bg-accent",
          )}
        >
          <entry.Icon
            className={cn("size-5 transition-transform", active && "scale-110")}
            aria-hidden="true"
          />
          {label}
        </Link>
      </li>
    );
  }

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border/60 bg-background/85 backdrop-blur-xl md:hidden"
      /* `viewportFit: "cover"` in the layout lets us pad past the home
         indicator instead of sitting underneath it. */
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="mx-auto flex max-w-md items-stretch justify-around gap-0.5 px-2 pt-1.5 pb-1">
        {/* Only the first tab goes left of the button; the rest share the right,
            so the button stays visually centred regardless of item count. */}
        {NAV_ITEMS[0] && tab(NAV_ITEMS[0], "left")}

        {/* Lifted above the bar's top edge so it reads as the primary action
            rather than another tab. */}
        <li className="flex flex-1 justify-center">
          <Link
            href={NAV_CENTER.href as Route}
            aria-label={NAV_CENTER.label}
            className={cn(
              "-mt-6 flex size-14 items-center justify-center rounded-full",
              "bg-primary text-primary-foreground shadow-lg shadow-primary/25",
              "transition-transform active:scale-95",
              "outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2",
            )}
          >
            <Plus className="size-7" aria-hidden="true" />
          </Link>
        </li>

        {NAV_ITEMS.slice(1).map((entry) => tab(entry, "right"))}
      </ul>
    </nav>
  );
}