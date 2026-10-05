"use client";

import type { Route } from "next";
import { cn } from "@betterbudgets/ui/lib/utils";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { Logo } from "./logo";
import { ModeToggle } from "./mode-toggle";
import { isActivePath, NAV_ITEMS } from "./nav-items";
import LockButton from "./vault/lock-button";
import UserMenu from "./user-menu";

export default function Header() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-xl supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between gap-3 px-4">
        {/* Marketing copy only appears on the locked screen, where a visitor may
            not have a ledger yet — pointing them at a local profile from the app
            chrome would be confusing. */}
        <Link
          href="/dashboard"
          aria-label="betterbudgets home"
          className="flex items-center gap-2.5 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          <Logo size={32} priority />
          <span className="text-lg font-semibold tracking-tight">betterbudgets</span>
        </Link>

        {/* Inline nav is the desktop counterpart of <BottomNav/>. */}
        <nav aria-label="Primary" className="hidden items-center gap-1 md:flex">
          {NAV_ITEMS.map(({ href, label }) => {
            const active = isActivePath(pathname, href);
            return (
              <Link
                key={href}
                href={href as Route}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-full px-4 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-primary-subtle text-primary"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                )}
              >
                {label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-2">
          <ModeToggle />
          <LockButton />
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
