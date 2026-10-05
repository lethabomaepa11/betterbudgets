/**
 * The wording and the judgement behind the reminders, asserted directly.
 *
 * These are claims about someone's money ("you can cover this", "short by X"),
 * so the failure mode is not a crash but telling someone something untrue. That
 * is worth pinning down precisely, especially the rule that money still on its
 * way counts toward covering a bill.
 */
import assert from "node:assert/strict";

import {
  buildBriefing,
  canCover,
  duePhrase,
  duePhraseShort,
  urgencyOf,
} from "./reminders.ts";

const format = (minor: number) => `£${(minor / 100).toFixed(2)}`;

/** A minimal occurrence; only the fields the briefing reads. */
function occurrence(over: Record<string, unknown> = {}) {
  return {
    id: "o1",
    rule_id: "r1",
    profile_id: "p1",
    account_id: "a1",
    category_id: null,
    name: "Rent",
    amount: 120000,
    type: "outflow",
    due_on: "2026-10-01",
    status: "pending",
    paid_transaction_id: null,
    settled_on: null,
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-01T00:00:00.000Z",
    deleted_at: null,
    origin: "local",
    accountName: "Checking",
    categoryName: null,
    daysUntil: 3,
    frequencyLabel: "Every month",
    ...over,
  } as never;
}

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
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

test("urgency bands", () => {
  assert.equal(urgencyOf(-1), "overdue");
  assert.equal(urgencyOf(0), "today");
  assert.equal(urgencyOf(1), "soon");
  assert.equal(urgencyOf(3), "soon");
  assert.equal(urgencyOf(4), "later");
});

test("due phrases read naturally", () => {
  assert.equal(duePhrase(0), "due today");
  assert.equal(duePhrase(1), "due tomorrow");
  assert.equal(duePhrase(5), "due in 5 days");
  assert.equal(duePhrase(-1), "1 day late");
  assert.equal(duePhrase(-4), "4 days late");
});

test("short badge phrases stay short", () => {
  assert.equal(duePhraseShort(0), "today");
  assert.equal(duePhraseShort(3), "3d");
  assert.equal(duePhraseShort(-2), "2d late");
});

test("a balance that covers the bill says so plainly", () => {
  const advice = canCover(200000, 120000);
  assert.equal(advice.covered, true);
  assert.equal(advice.shortBy, 0);
  assert.equal(advice.message, "You can cover this.");
});

test("money on its way counts toward covering the bill", () => {
  // Salary lands on the 30th, rent on the 1st. Without this rule the dashboard
  // would tell someone they are short on a bill they are about to be paid for.
  const advice = canCover(5000, 120000, 115000);
  assert.equal(advice.covered, true);
  assert.match(advice.message, /money due in arrives/);
});

test("a real shortfall is reported with the amount", () => {
  const advice = canCover(5000, 120000);
  assert.equal(advice.covered, false);
  assert.equal(advice.shortBy, 115000);
  assert.equal(format(advice.shortBy), "£1150.00");
  assert.match(advice.message, /Short/);
});

test("exactly enough money still counts as covered", () => {
  assert.equal(canCover(5000, 120000, 115000).covered, true);
});

test("briefing says nothing when nothing needs attention", () => {
  const briefing = buildBriefing([occurrence({ daysUntil: 20 })], { balance: 500000, format });
  assert.equal(briefing.headline, null);
  assert.equal(briefing.needsAttention, false);
});

test("briefing names a single imminent item", () => {
  const briefing = buildBriefing([occurrence({ daysUntil: 2 })], { balance: 500000, format });
  assert.equal(briefing.needsAttention, true);
  assert.equal(briefing.headline, "Rent is due in 2 days.");
});

test("briefing counts several imminent items", () => {
  const briefing = buildBriefing(
    [
      occurrence({ id: "a", name: "Rent", daysUntil: 2 }),
      occurrence({ id: "b", name: "Salary", type: "inflow", amount: 300000, daysUntil: 1 }),
      occurrence({ id: "c", name: "Phone", daysUntil: 30 }),
    ],
    { balance: 500000, format },
  );
  assert.equal(briefing.headline, "2 things need you in the next three days.");
  assert.equal(briefing.needsAttention, true);
});

test("briefing sorts the most urgent first regardless of input order", () => {
  const briefing = buildBriefing(
    [
      occurrence({ id: "late", daysUntil: 9 }),
      occurrence({ id: "now", daysUntil: 0 }),
      occurrence({ id: "soon", daysUntil: 2 }),
    ],
    { balance: 0, format },
  );
  assert.deepEqual(
    briefing.items.map((item) => item.id),
    ["now", "soon", "late"],
  );
});

test("briefing works out what is left to save", () => {
  // Minor units: balance £500.00, £3000.00 arriving, £1200.00 going out.
  const briefing = buildBriefing(
    [
      occurrence({ id: "out", type: "outflow", amount: 120_000 }),
      occurrence({ id: "in", type: "inflow", amount: 300_000 }),
    ],
    { balance: 50_000, format },
  );
  assert.equal(format(briefing.surplus), "£2300.00");
});

test("a negative surplus is negative, not clamped", () => {
  // Clamping this to zero would hide a genuine overspend behind "you have
  // nothing spare", which reads as reassurance rather than a warning.
  // £500.00 in the bank, £2000.00 due out.
  const briefing = buildBriefing([occurrence({ amount: 200_000 })], { balance: 50_000, format });
  assert.equal(format(briefing.surplus), "£-1500.00");
});

test("briefing handles an empty window", () => {
  const briefing = buildBriefing([], { balance: 100000, format });
  assert.equal(briefing.headline, null);
  assert.equal(briefing.items.length, 0);
  assert.equal(format(briefing.surplus), "£1000.00");
});

console.log(`\n${passed} reminder assertions passed`);

// Throwing is what makes the harness exit non-zero.
if (failed > 0) throw new Error(`${failed} reminder assertion(s) failed`);