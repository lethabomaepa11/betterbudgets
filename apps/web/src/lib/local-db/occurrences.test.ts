/**
 * What an edit does to occurrences already queued.
 *
 * The rule row is the easy half of editing a series. This is the half with
 * real consequences: get it wrong and the dashboard either keeps asking for the
 * old rent for months, or quietly deletes a payment the user already agreed to.
 *
 * Runs against the pure planner rather than a database, so each scenario reads
 * as a list of dates and what should happen to them.
 *
 * Run: node --experimental-strip-types apps/web/src/lib/local-db/occurrences.test.ts
 */
import assert from "node:assert/strict";

import { datesForRule, planOccurrenceEdit } from "./occurrences.ts";

import type { PlannedOccurrence, RecurrenceRule } from "./schema.ts";

/** The fields the planner reads; everything else is irrelevant to it. */
function occurrence(id: string, dueOn: string, status = "pending") {
  return {
    id,
    rule_id: "r1",
    profile_id: "p1",
    account_id: "a1",
    category_id: null,
    name: "Rent",
    amount: 120000,
    type: "outflow",
    due_on: dueOn,
    status,
    paid_transaction_id: null,
    settled_on: null,
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-01T00:00:00.000Z",
    deleted_at: null,
    origin: "local",
  } as PlannedOccurrence;
}

function rule(over: Partial<RecurrenceRule> = {}): RecurrenceRule {
  return { frequency: "monthly", anchor: "day_of_month", dayOfMonth: 1, ...over };
}

const ids = (rows: readonly PlannedOccurrence[]) => rows.map((row) => row.id);

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
  } catch (cause) {
    failed += 1;
    const detail = cause instanceof Error ? cause.message : String(cause);
    console.log(`  FAIL  ${name} - ${detail.replace(/\s+/g, " ").slice(0, 220)}`);
    return;
  }
  passed += 1;
  console.log(`  ok  ${name}`);
}

test("the dates a rule produces cover the horizon, not a fixed count", () => {
  const monthly = datesForRule("2026-10-01", rule({ dayOfMonth: 1 }));
  assert.ok(monthly.has("2026-11-01"), "must reach the next month");
  assert.ok(monthly.has("2027-10-01"), "must reach a year out");
  assert.ok(monthly.has("2026-10-01"), "must include the start date");

  // The guard counts iterations, not distance: 200 steps is 200 months for a
  // monthly rule and 200 days for a daily one, so both must stop rather than spin.
  const daily = datesForRule("2026-10-01", rule({ frequency: "daily" }));
  assert.ok(daily.size >= 200, `daily only produced ${daily.size} dates`);
});

test("an occurrence on a date no longer produced is retired", () => {
  // Moving rent from the 1st to the last working day leaves the 1st standing
  // forever asking to be paid, if nothing retires it.
  const wanted = datesForRule("2026-10-30", rule({ anchor: "last_weekday" }));
  const plan = planOccurrenceEdit([occurrence("old-date", "2026-11-01")], wanted, "future");

  assert.deepEqual(ids(plan.retire), ["old-date"]);
  assert.deepEqual(ids(plan.keep), [], "nothing belongs on the new date yet");
});

test("an occurrence on a date still produced is rewritten", () => {
  const wanted = datesForRule("2026-11-01", rule({ dayOfMonth: 1 }));
  const plan = planOccurrenceEdit(
    [occurrence("stays", "2026-11-01"), occurrence("also", "2026-12-01")],
    wanted,
    "future",
  );

  assert.deepEqual(ids(plan.keep).sort(), ["also", "stays"]);
  assert.deepEqual(ids(plan.retire), []);
});

test("after_next preserves the earliest payment only", () => {
  const wanted = datesForRule("2026-11-01", rule({ dayOfMonth: 1 }));
  const plan = planOccurrenceEdit(
    [
      occurrence("next", "2026-11-01"),
      occurrence("later", "2026-12-01"),
      occurrence("later2", "2027-01-01"),
    ],
    wanted,
    "after_next",
  );

  assert.deepEqual(ids(plan.preserve), ["next"], "the imminent one keeps its terms");
  assert.deepEqual(ids(plan.keep).sort(), ["later", "later2"], "the rest take the new terms");
});

test("after_next preserves the earliest by date, not by row order", () => {
  // A stale row listed first must not become the protected payment.
  const wanted = datesForRule("2026-11-01", rule({ dayOfMonth: 1 }));
  const plan = planOccurrenceEdit(
    [occurrence("stale", "2026-12-01"), occurrence("genuinely-next", "2026-11-01")],
    wanted,
    "after_next",
  );

  assert.deepEqual(ids(plan.preserve), ["genuinely-next"]);
  assert.deepEqual(ids(plan.keep), ["stale"]);
});

test("future scope touches everything, including the next payment", () => {
  const wanted = datesForRule("2026-11-01", rule({ dayOfMonth: 1 }));
  const plan = planOccurrenceEdit(
    [occurrence("next", "2026-11-01"), occurrence("later", "2026-12-01")],
    wanted,
    "future",
  );

  assert.deepEqual(ids(plan.preserve), [], "future scope protects nothing");
  assert.deepEqual(ids(plan.keep).sort(), ["later", "next"]);
});


test("a plan partitions every pending occurrence exactly once", () => {
  // The invariant that matters: an occurrence landing in two buckets is rewritten
  // and retired at once, and one landing in none disappears silently. High and
  // low dates are mixed in deliberately, since only the low ones should retire.
  const wanted = datesForRule("2026-10-01", rule({ dayOfMonth: 1 }));
  const pending = [
    occurrence("a", "2026-10-01"),
    occurrence("b", "2026-10-15"),
    occurrence("c", "2026-11-01"),
    occurrence("d", "2027-06-07"),
  ];
  const plan = planOccurrenceEdit(pending, wanted, "after_next");

  const counted = [...ids(plan.keep), ...ids(plan.retire), ...ids(plan.preserve)];
  assert.equal(counted.length, pending.length, "an occurrence was dropped");
  assert.equal(new Set(counted).size, pending.length, "an occurrence was bucketed twice");
  // Only the 1st of a month is a due date under this rule, so the two dates that
  // fall mid-month are retired. `after_next` protects the earliest.
  assert.deepEqual(ids(plan.retire).sort(), ["b", "d"]);
  assert.deepEqual(ids(plan.preserve), ["a"]);
  assert.deepEqual(ids(plan.keep), ["c"]);
});

test("a settled occurrence is never rewritten by an edit", () => {
  // `paid` and `skipped` record what actually happened. The planner is only ever
  // handed pending rows, but a caller that forgets should get a no-op rather than
  // silently rewriting history.
  const wanted = datesForRule("2026-11-01", rule({ dayOfMonth: 1 }));
  const plan = planOccurrenceEdit([occurrence("paid", "2026-11-01", "paid")], wanted, "future");

  assert.deepEqual(ids(plan.keep), []);
  assert.deepEqual(ids(plan.retire), []);
  assert.deepEqual(ids(plan.preserve), []);
});

test("an empty pending list plans to nothing", () => {
  const plan = planOccurrenceEdit([], new Set(), "future");
  assert.deepEqual(plan.keep, []);
  assert.deepEqual(plan.retire, []);
  assert.deepEqual(plan.preserve, []);
});


console.log(`\n${passed} occurrence-edit assertions passed`);
if (failed > 0) throw new Error(`${failed} occurrence-edit assertion(s) failed`);
