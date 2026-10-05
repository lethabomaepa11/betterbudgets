"use client";

import type { Route } from "next";
import Link from "next/link";

import { MORE_SCREENS } from "@/components/nav-items";

/**
 * Everything that is not a daily destination.
 *
 * Exists because the tab bar is capped at five slots. The four tabs cover what
 * someone checks by habit; this screen holds what they open on purpose. Each row
 * says what the screen is for, because "Reports" and "Activity" are only
 * distinguishable once you are inside them.
 */
export default function MorePage() {
  return (
    <div className="mx-auto w-full max-w-md">
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">More</h1>

      <div className="flex flex-col gap-8">
        {MORE_SCREENS.map((group) => (
          <section key={group.title} className="space-y-2">
            <h2 className="text-sm font-medium">{group.title}</h2>
            <ul className="flex flex-col gap-1.5">
              {group.items.map(({ href, label, description, Icon }) => (
                <li key={href}>
                  <Link
                    href={href as Route}
                    className="flex min-h-14 items-center gap-3 rounded-2xl border p-3.5 transition-colors hover:bg-accent/50"
                  >
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted">
                      <Icon className="size-5" aria-hidden="true" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{label}</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {description}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}