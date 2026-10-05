"use client";

import { SCREENS, STEP_COPY } from "@/lib/onboarding-steps";
import { useVault } from "@/lib/local-db/vault";

/**
 * The chrome shared by every setup screen.
 *
 * A step per route rather than a modal: setup is the only thing a new user sees
 * before they can start budgeting, so it gets room to explain itself instead of
 * being crammed into a card over a blurred dashboard.
 */
export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  const { activeProfile } = useVault();

  // Index into SCREENS, not STEPS: `currency` and `purpose` are one screen, so
  // counting the latter would show 4 of 5 on a flow that only has four screens.
  const currentIndex = SCREENS.indexOf(
    activeProfile?.onboarding_step === "purpose" ? "currency" : (activeProfile?.onboarding_step ?? "currency"),
  );
  const reached = currentIndex < 0 ? 0 : currentIndex;

  return (
    <div className="mx-auto w-full max-w-md py-4 sm:py-10">
      {/* Progress is positional rather than a percentage: "2 of 4" stays honest
          when a step can be skipped entirely. */}
      <div className="mb-8">
        <ol className="flex gap-1.5" aria-hidden="true">
          {SCREENS.map((step, index) => (
            <li
              key={step}
              className={`h-1 flex-1 rounded-full transition-colors ${
                index < reached ? "bg-primary" : "bg-muted"
              }`}
            />
          ))}
        </ol>

        {/* The visible label lives outside the aria-hidden rail, so a screen
            reader hears the position instead of an unlabelled set of bars. */}
        <p aria-live="polite" className="mt-2 text-xs text-muted-foreground">
          Step {Math.min(reached + 1, SCREENS.length)} of {SCREENS.length} ·{" "}
          {STEP_COPY[SCREENS[reached] ?? "currency"].title}
        </p>
      </div>

      {children}
    </div>
  );
}