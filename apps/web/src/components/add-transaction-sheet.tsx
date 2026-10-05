"use client";

import { useEffect, useRef } from "react";

import { cn } from "@betterbudgets/ui/lib/utils";
import { ArrowDownLeft, Check, Repeat, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { NAV_CENTER, type ChoiceIcon } from "@/lib/nav-model";

const CHOICE_ICON: Record<ChoiceIcon, typeof Repeat> = {
  once: ArrowDownLeft,
  repeat: Repeat,
};

/**
 * The sheet the centre button opens: one-off, or repeating.
 *
 * A sheet over a page because both answers are equally likely — most entries are
 * one-offs, but the repeating ones are the ones that quietly go wrong when filed
 * the wrong way. A default that guessed would be right most of the time and
 * silently wrong the rest, and the damage is a rent payment that never appears.
 *
 * Escape and a click on the scrim both close it, and focus moves into the dialog
 * on open so a keyboard is not left behind on the page underneath.
 */
export default function AddTransactionSheet({
  onClose,
}: {
  onClose: () => void;
}) {
  const router = useRouter();
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Focus moves into the dialog on open. Without it, Tab walks straight past the
    // sheet into the page behind, which is still mounted and still focusable.
    panel.current?.querySelector<HTMLElement>("a, button")?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      // Traps Tab inside the sheet. Without it, tabbing walks off into the page
      // behind, which is still mounted and still focusable.
      if (event.key !== "Tab" || !panel.current) return;

      const focusable = panel.current.querySelectorAll<HTMLElement>("a[href], button:not([disabled])");
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      {/* Scrim. A button so it is reachable by keyboard, not just by pointer. */}
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-foreground/40 backdrop-blur-sm"
      />

      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-transaction-title"
        /* Lifts clear of the home indicator rather than sitting underneath it. */
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 1rem)" }}
        className="relative w-full max-w-md rounded-t-3xl bg-background p-5 pb-6 shadow-sheet"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 id="add-transaction-title" className="text-lg font-semibold tracking-tight">
            What are you adding?
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex size-9 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>

        <ul className="flex flex-col gap-2">
          {NAV_CENTER.choices.map((choice) => {
            const Icon = CHOICE_ICON[choice.Icon];
            return (
              <li key={choice.href}>
                <Link
                  href={choice.href}
                  onClick={onClose}
                  className={cn(
                    "flex min-h-16 w-full items-center gap-3 rounded-2xl border p-4 text-left transition-colors",
                    "hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none",
                  )}
                >
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted">
                    <Icon className="size-5" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{choice.title}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {choice.description}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>

        <button
          type="button"
          onClick={() => {
            onClose();
            router.push("/recurring");
          }}
          className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-2xl px-4 py-2.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <Check className="size-4" aria-hidden="true" />
          I already set this up to repeat
        </button>
      </div>
    </div>
  );
}