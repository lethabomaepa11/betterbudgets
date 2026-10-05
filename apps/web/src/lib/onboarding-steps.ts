import type { Route } from "next";

import type { OnboardingStep } from "@/lib/local-db";

/**
 * The guided setup, as an ordered list.
 *
 * Each step is a screen rather than a modal: onboarding is the only thing a new
 * user sees before they can start budgeting, so it gets room to explain itself
 * instead of being crammed into a card over a blurred dashboard.
 *
 * Every step is skippable. The spec is explicit that configuration must never be
 * forced, and a user who already knows how they spend should reach the app in one
 * tap — the categories and budget steps default to sensible values that can be
 * changed later in Settings.
 */
/** The screens a user actually walks through, in order. */
export const SCREENS: readonly OnboardingStep[] = [
  "currency",
  "account",
  "categories",
  "budget",
];

/**
 * The first screen records *two* progress values, so the step a screen lands on
 * is not always its own name.
 *
 * `purpose` is a value we store (it tunes later suggestions) but it is written by
 * the currency screen and has no screen of its own — routing to it would land the
 * user back where they started, which reads as a dead button.
 */
const STEP_LANDS_ON: Record<OnboardingStep, OnboardingStep> = {
  currency: "currency",
  purpose: "currency",
  account: "account",
  categories: "categories",
  budget: "budget",
  done: "done",
};

/** The screen a step is rendered on. */
export function screenFor(step: OnboardingStep): OnboardingStep {
  return STEP_LANDS_ON[step];
}

/**
 * The step to *persist* when leaving `step`.
 *
 * Advances by screen, not by progress value, so leaving the combined first screen
 * lands on `account` rather than looping back through `purpose`.
 */
export function nextPersistedStep(step: OnboardingStep): OnboardingStep {
  const index = SCREENS.indexOf(screenFor(step));
  return SCREENS[index + 1] ?? "done";
}

/** Copy per step, kept beside the order so the flow reads in one place. */
export const STEP_COPY: Record<OnboardingStep, { title: string; body: string }> = {
  currency: {
    title: "What currency do you use?",
    body: "This only changes how amounts are shown. You can change it later.",
  },
  purpose: {
    title: "What are you budgeting for?",
    body: "We'll suggest categories that fit. Nothing here is locked in.",
  },
  account: {
    title: "Where does your money currently live?",
    body: "Start with one account — a bank account, or the cash in your wallet. You can add more later.",
  },
  categories: {
    title: "How do you want to sort your spending?",
    body: "We've picked a common set. Keep them, rename them, or add your own.",
  },
  budget: {
    title: "Do you want to set a first budget?",
    body: "A limit per category tells you where you stand before you've spent anything.",
  },
  done: { title: "You're all set", body: "" },
};

/** Skippable steps. The credential step lives outside onboarding entirely. */
const SKIPPABLE: readonly OnboardingStep[] = ["purpose", "account", "categories", "budget"];

/**
 * Where each step is *rendered*.
 *
 * Not derivable from the step name: steps 1 and 2 share a single screen, because
 * a first run should cost three taps rather than five. Deriving the path as
 * `/onboarding/${step}` therefore 404s on `currency` and `purpose` — which is
 * exactly the bug this table exists to prevent. A step name is a progress value,
 * never a route.
 */
export const STEP_ROUTES: Partial<Record<OnboardingStep, Route>> = {
  currency: "/onboarding",
  purpose: "/onboarding",
  account: "/onboarding/account",
  categories: "/onboarding/categories",
  budget: "/onboarding/budget",
  done: "/dashboard",
};

/** The screen for a step. Falls back to the app when a step has no screen. */
export function routeForStep(step: OnboardingStep): Route {
  return STEP_ROUTES[step] ?? "/dashboard";
}

export function stepIsSkippable(step: OnboardingStep): boolean {
  return SKIPPABLE.includes(step);
}

/** The screen before `step`, or null when there isn't one. */
export function previousScreen(step: OnboardingStep): OnboardingStep | null {
  const index = SCREENS.indexOf(screenFor(step));
  return index > 0 ? SCREENS[index - 1] : null;
}