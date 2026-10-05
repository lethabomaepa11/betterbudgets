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

  function tab(entry: (typeof NAV_ITEMS)[number]) {
    const active = isActivePath(pathname, entry.href);

    return (
      <li key={entry.href} className="flex-1">
        <Link
          href={entry.href as Route}
          aria-current={active ? "page" : undefined}
          aria-label={entry.label}
          className={cn(
            // min-h-12 keeps the tap target at 48px. The bar is five slots wide
            // and no more, so the labels are left as real words rather than
            // truncated: "Act" and "Rep" are not navigation, they are guessing.
            "flex min-h-12 min-w-0 flex-col items-center justify-center gap-1 rounded-2xl px-1 py-1.5",
            "text-[11px] font-medium transition-colors",
            active ? "text-primary" : "text-muted-foreground hover:text-foreground active:bg-accent",
          )}
        >
          <entry.Icon
            className={cn("size-5 shrink-0 transition-transform", active && "scale-110")}
            aria-hidden="true"
          />
          <span className="max-w-full truncate">{entry.label}</span>
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
      {/* Two tabs, the button, two tabs. Fixed at five slots so the button stays
          centred and every target stays wide enough to hit. */}
      <ul className="mx-auto flex max-w-md items-stretch justify-around gap-0.5 px-2 pt-1.5 pb-1">
        {NAV_ITEMS.slice(0, 2).map((entry) => tab(entry))}

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

        {NAV_ITEMS.slice(2).map((entry) => tab(entry))}
      </ul>
    </nav>
  );
}