/**
 * The routing rules for onboarding, asserted directly.
 *
 * This exists because the flow was broken twice by reasoning instead of
 * checking: once by deriving a path from a step name (404), and once by having
 * "what do we persist" and "where do we go" disagree â€” which made Continue
 * navigate to the page it was already on, so it looked like a dead button.
 *
 * Run with: node --experimental-strip-types apps/web/src/lib/onboarding-steps.test.ts
 */
import assert from "node:assert/strict";

import type { OnboardingStep } from "@/lib/local-db";

import {
  SCREENS,
  nextPersistedStep,
  previousScreen,
  routeForStep,
  screenFor,
} from "./onboarding-steps.ts";

const ALL_STEPS: OnboardingStep[] = [
  "currency",
  "purpose",
  "account",
  "categories",
  "budget",
  "done",
];

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  // Catches and reports rather than throwing, so one failure does not hide the
  // rest. `failed` is what makes the run exit non-zero at the bottom.
  try {
    fn();
  } catch (cause) {
    failed += 1;
    const detail = cause instanceof Error ? cause.message : String(cause);
    console.log(`  FAIL  ${name} - ${detail.replace(/\s+/g, " ").slice(0, 200)}`);
    return;
  }
  passed += 1;
  console.log(`  ok  ${name}`);
}

test("the whole flow reaches the dashboard, visiting each screen once", () => {
  let step: OnboardingStep = "currency";
  const visited: string[] = [];

  for (let guard = 0; guard < 10; guard += 1) {
    visited.push(routeForStep(step));

    // The regression that broke the Continue button: a step whose route is the
    // page you are already on renders as a no-op press.
    if (step === "done") break;
    const next = nextPersistedStep(step);
    assert.notEqual(routeForStep(next), routeForStep(step), `Continue on ${step} navigates to itself`);
    step = next;
  }

  assert.equal(step, "done", `flow stalled at ${step} after ${visited.join(", ")}`);
  assert.equal(routeForStep(step), "/dashboard");
  // Each screen once in order, then the app.
  assert.deepEqual(
    visited,
    [...SCREENS.map(routeForStep), "/dashboard"],
    "screens must be visited once, in order, then hand off to the app",
  );
});

test("leaving the first screen moves off it", () => {
  // The exact bug: Continue persisted "account" but routed by "purpose", which
  // maps back to /onboarding â€” the page it was already on.
  const next = nextPersistedStep("currency");
  assert.equal(next, "account");
  assert.equal(routeForStep(next), "/onboarding/account");
});

test("no screen routes to itself when you press Continue", () => {
  for (const screen of SCREENS) {
    const next = nextPersistedStep(screen);
    if (next === "done") continue;
    assert.notEqual(routeForStep(next), routeForStep(screen), `${screen} navigates to itself`);
  }
});

test("every step has a real route", () => {
  for (const step of ALL_STEPS) {
    assert.ok(routeForStep(step).startsWith("/"), `${step} has no route`);
  }
});

test("no step maps to a route that does not exist", () => {
  // Guards the original 404: `purpose` is a stored value, not a screen, so
  // giving it a `/onboarding/purpose` entry would point at a missing page.
  const real = new Set(SCREENS.map(routeForStep));
  for (const step of ALL_STEPS) {
    const route = routeForStep(step);
    if (step === "done") {
      assert.equal(route, "/dashboard");
      continue;
    }
    assert.ok(real.has(route), `${step} maps to ${route}, which is not a screen`);
  }
  assert.equal(screenFor("purpose"), "currency");
  assert.equal(routeForStep("purpose"), routeForStep("currency"));
});

test("back navigation mirrors forward navigation", () => {
  assert.equal(previousScreen("currency"), null);
  assert.equal(previousScreen("account"), "currency");
  assert.equal(previousScreen("categories"), "account");
  assert.equal(previousScreen("budget"), "categories");

  for (const screen of SCREENS) {
    const next = nextPersistedStep(screen);
    if (next === "done") continue;
    assert.equal(previousScreen(next), screen, `back from ${next} should reach ${screen}`);
  }
});

console.log(`\n${passed} onboarding routing assertions passed`);
if (failed > 0) throw new Error(`${failed} onboarding routing assertion(s) failed`);
