"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import {
  SUPPORTED_CURRENCIES,
  currencyLabel,
  DEFAULT_CURRENCY,
  type BudgetFor,
  type OnboardingStep,
} from "@/lib/local-db";
import { useVault } from "@/lib/local-db/vault";

import { STEP_COPY, nextPersistedStep, routeForStep, stepIsSkippable } from "@/lib/onboarding-steps";

const PURPOSES: readonly { value: BudgetFor; label: string; hint: string }[] = [
  { value: "personal", label: "Just me", hint: "My own money" },
  { value: "household", label: "Household", hint: "Shared with family" },
  { value: "student", label: "Student", hint: "Limited income, tight budget" },
  { value: "family", label: "Family", hint: "Saving for others" },
  { value: "business", label: "Work / side project", hint: "Separate from personal" },
  { value: "other", label: "Something else", hint: "" },
];

/**
 * Steps 1 and 2 — currency and purpose.
 *
 * Both are single-tap choices, so they share a screen. Combining them is what
 * lets the whole first run be three taps instead of five, which matters when the
 * whole promise is "usable immediately, no account required".
 */
export default function OnboardingStartPage() {
  const router = useRouter();
  const { activeProfile, updateSettings, setOnboardingStep, busy, error } = useVault();

  const [currency, setCurrency] = useState(activeProfile?.currency ?? DEFAULT_CURRENCY);
  const [purpose, setPurpose] = useState<BudgetFor | null>(null);

  const STEP: OnboardingStep = "currency";

  // The credential screen is part of this route but not this step list: a new
  // profile has no PIN yet, so unlocking happens implicitly as part of creating
  // one. Steps 1 and 2 share this screen, so "the current step" is the first.
  async function advance() {
    // Currency is written through settings; purpose rides along with the step
    // write. Saving currency first means a failure here leaves the user where
    // they were rather than half-way into onboarding with no currency saved.
    if (currency !== activeProfile?.currency) {
      const ok = await updateSettings({
        name: activeProfile?.name ?? "",
        currency,
      });
      if (!ok) return;
    }

    // One source of truth for "where next": `nextPersistedStep` decides both
    // what to persist and where to go, so the two can never disagree — which is
    // what made Continue look like a dead button.
    const next = nextPersistedStep(STEP);
    await setOnboardingStep(next, purpose);
    router.push(routeForStep(next));
  }

  return (
    <div className="flex flex-col gap-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">{STEP_COPY.currency.title}</h1>
        <p className="text-sm/relaxed text-muted-foreground">{STEP_COPY.currency.body}</p>
      </header>

      {/* Grid rather than a select: with ten options, seeing them all at once
          beats opening a dropdown to compare. */}
      <div className="grid grid-cols-2 gap-2">
        {SUPPORTED_CURRENCIES.map((code) => (
          <button
            key={code}
            type="button"
            aria-pressed={currency === code}
            onClick={() => setCurrency(code)}
            className={`h-12 rounded-2xl border text-sm font-medium transition-colors ${
              currency === code
                ? "border-primary bg-primary-subtle text-primary"
                : "border-input hover:bg-accent/50"
            }`}
          >
            {code}
          </button>
        ))}
      </div>

      <p className="-mt-4 text-xs text-muted-foreground">
        {currencyLabel(currency)}
      </p>

      <section className="space-y-3">
        <h2 className="text-base font-medium">{STEP_COPY.purpose.title}</h2>
        <p className="-mt-2 text-sm/relaxed text-muted-foreground">
          {STEP_COPY.purpose.body}
        </p>

        <div className="grid gap-2 sm:grid-cols-2">
          {PURPOSES.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={purpose === option.value}
              onClick={() => setPurpose(option.value)}
              className={`rounded-2xl border p-3 text-left transition-colors ${
                purpose === option.value
                  ? "border-primary bg-primary-subtle"
                  : "border-input hover:bg-accent/50"
              }`}
            >
              <span className="block text-sm font-medium">{option.label}</span>
              {option.hint && (
                <span className="block text-xs text-muted-foreground">{option.hint}</span>
              )}
            </button>
          ))}
        </div>
      </section>

      {error && (
        <p role="alert" className="text-sm text-expense-strong">
          {error}
        </p>
      )}

      <button
        type="button"
        disabled={busy}
        onClick={() => void advance()}
        className="h-14 w-full rounded-2xl bg-primary text-base font-medium text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-50"
      >
        {busy ? "Saving…" : "Continue"}
      </button>

      {stepIsSkippable("purpose") && (
        <button
          type="button"
          onClick={() => void advance()}
          className="h-11 w-full text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          Skip for now
        </button>
      )}
    </div>
  );
}