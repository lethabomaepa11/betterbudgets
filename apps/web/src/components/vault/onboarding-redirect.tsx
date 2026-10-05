"use client";

import { useEffect } from "react";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";

import type { OnboardingStep } from "@/lib/local-db";
import { routeForStep } from "@/lib/onboarding-steps";

/**
 * Sends someone who has a profile but hasn't finished setup into the flow.
 *
 * Kept as its own component rather than a `router.push` inside the gate: the gate
 * returns early in several branches, so a hook called there would break the rules
 * of hooks. This mounts only in the one branch that needs it.
 *
 * `replace` rather than `push` so Back doesn't bounce between the dashboard and
 * the step it just redirected away from.
 */
export default function OnboardingRedirect({ step }: { step: OnboardingStep }) {
  const router = useRouter();

  useEffect(() => {
    // Routed through `routeForStep` rather than interpolating the step name:
    // `currency` and `purpose` are two progress values on one screen, so
    // `/onboarding/${step}` would 404 for most new users.
    router.replace(routeForStep(step));
  }, [step, router]);

  return (
    <div
      className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-muted-foreground"
      role="status"
    >
      <Loader2 className="size-5 animate-spin" aria-hidden="true" />
      <p className="text-sm">Picking up where you left off…</p>
    </div>
  );
}