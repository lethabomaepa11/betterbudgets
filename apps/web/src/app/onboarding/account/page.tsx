"use client";

import { useEffect, useState } from "react";

import type { Route } from "next";
import { Check, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";

import AccountForm from "@/components/account-form";
import { STEP_COPY } from "@/lib/onboarding-steps";
import { useVault } from "@/lib/local-db/vault";

import { useAccounts } from "@/hooks/use-accounts";

/**
 * Step 3 — the first account.
 *
 * Every transaction needs somewhere to live, so this is the one setup step that
 * carries real weight: without it the app can still show a dashboard, but the
 * person cannot log anything, which is the whole point. That is why it is
 * skippable in the sense of "you can come back", not "you can ignore it" — the
 * screen says so plainly, and the empty state afterwards keeps offering itself.
 */
export default function OnboardingAccountPage() {
  const router = useRouter();
  const { activeProfile, setOnboardingStep, busy, error } = useVault();
  const accounts = useAccounts();

  const [saving, setSaving] = useState(false);

  // Someone who already created an account before this step ran (or resumed
  // after a crash) should not be asked again.
  useEffect(() => {
    if (accounts.length > 0 && activeProfile?.onboarding_step === "account") {
      void setOnboardingStep("categories");
      router.replace("/onboarding/categories" as Route);
    }
  }, [accounts.length, activeProfile?.onboarding_step, setOnboardingStep, router]);

  async function done() {
    setSaving(true);
    await setOnboardingStep("categories");
    router.push("/onboarding/categories" as Route);
  }

  async function skip() {
    setSaving(true);
    await setOnboardingStep("categories");
    router.push("/onboarding/categories" as Route);
  }

  return (
    <div className="flex flex-col gap-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">{STEP_COPY.account.title}</h1>
        <p className="text-sm/relaxed text-muted-foreground">{STEP_COPY.account.body}</p>
      </header>

      <AccountForm
        onDone={() => void done()}
      />

      {error && (
        <p role="alert" className="text-sm text-expense-strong">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={() => void skip()}
        disabled={saving || busy}
        className="h-11 w-full text-sm text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
      >
        {saving ? (
          <span className="inline-flex items-center gap-2">
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            Opening…
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5">
            <Check className="size-3.5" aria-hidden="true" />
            I&apos;ll do this later
          </span>
        )}
      </button>

      <p className="-mt-4 text-center text-xs text-muted-foreground">
        You can add one from the dashboard at any time.
      </p>
    </div>
  );
}