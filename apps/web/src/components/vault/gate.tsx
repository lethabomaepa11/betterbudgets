"use client";

import { useEffect, useState } from "react";
import { CircleAlert, Loader2, RefreshCcw } from "lucide-react";

import { Logo } from "@/components/logo";
import { useVault } from "@/lib/local-db/vault";
import { useLocalDb } from "@/lib/local-db/provider";

import VaultLock from "./lock";
import VaultOnboarding from "./onboarding";
import OnboardingRedirect from "./onboarding-redirect";

/**
 * Chooses what the app shows: bootstrap, first-run setup, the lock screen, or
 * the real children.
 *
 * Rendering the children is gated on `status === "unlocked"`, which is derived
 * from React state that nothing ever writes to storage. That is what makes
 * "close the tab and you must unlock again" true by construction rather than
 * by discipline.
 */
export default function VaultGate({ children }: { children: React.ReactNode }) {
  const { status, activeProfile } = useVault();
  const [hasTransfer, setHasTransfer] = useState<boolean | null>(null);
  const {
    status: dbStatus,
    reason,
    retry,
  } = useLocalDb();

  useEffect(() => {
    setHasTransfer(Boolean(new URLSearchParams(window.location.search).get("transfer")));
  }, []);

  if (status === "checking" && dbStatus !== "unavailable") {
    return (
      <div
        className="flex min-h-[50vh] flex-col items-center justify-center gap-4 text-muted-foreground"
        role="status"
        aria-live="polite"
      >
        <Logo
          size={56}
          priority
          className="motion-safe:animate-[logo-loader_1.4s_ease-in-out_infinite]"
        />
        <div className="flex items-center gap-2">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          <p className="text-sm">Opening your budget…</p>
        </div>
      </div>
    );
  }

  if (status === "onboard") return <VaultOnboarding />;

  if (hasTransfer === null && status === "unlocked") {
    return (
      <div className="flex min-h-[50vh] items-center justify-center" role="status">
        <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden="true" />
        <span className="sr-only">Preparing transfer</span>
      </div>
    );
  }

  // Someone who has a profile but hasn't finished setup is sent into the flow
  // rather than dropped onto a dashboard they haven't configured. Declared after
  // the locked check and before the children so a locked vault still wins.
  if (
    status === "unlocked" &&
    activeProfile &&
    activeProfile.onboarding_step !== "done" &&
    !hasTransfer
  ) {
    return <OnboardingRedirect step={activeProfile.onboarding_step} />;
  }

  // A transfer link is also the onboarding context for a new destination
  // profile. Keep the URL intact until the profile exists and the receiver has
  // restored its data; otherwise the normal onboarding redirect drops the
  // encrypted transfer key from the URL.
  if (
    status === "unlocked" &&
    activeProfile &&
    activeProfile.onboarding_step !== "done" &&
    hasTransfer
  ) {
    return <VaultOnboarding />;
  }

  if (status === "locked") return <VaultLock />;

  // A dead database leaves `useVault()` stuck on "checking" — its status is
  // derived from `dbStatus` — so the spinner above is explicitly guarded
  // against that case. Reaching here means the database itself failed, not a
  // slow boot.
  if (dbStatus === "unavailable") {
    return (
      <div className="mx-auto flex w-full max-w-md flex-col items-center gap-4 rounded-3xl bg-card p-8 text-center shadow-card ring-1 ring-foreground/6">
        <span className="flex size-12 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
          <CircleAlert className="size-6" aria-hidden="true" />
        </span>

        <div className="space-y-1.5">
          <h1 className="text-xl font-semibold tracking-tight">Local database won&apos;t open</h1>
          <p className="text-sm/relaxed text-muted-foreground">
            {reason ?? "The database engine could not be started on this device."}
          </p>
        </div>

        <button
          type="button"
          onClick={retry}
          className="inline-flex h-11 items-center gap-2 rounded-full bg-primary px-5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover"
        >
          <RefreshCcw className="size-4" aria-hidden="true" />
          Try again
        </button>

        <p className="text-xs text-muted-foreground">
          Nothing is signed in or synced until the database opens, so it is safe to retry.
        </p>
      </div>
    );
  }

  return <>{children}</>;
}
