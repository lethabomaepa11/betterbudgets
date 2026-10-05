/**
 * Date rules for recurrences, asserted directly.
 *
 * This exists because the bugs here are invisible until someone's rent is
 * silently dated to the 28th of every month forever, or a salary lands in the
 * previous month. Neither shows up in a typecheck.
 *
 * Run: node --experimental-strip-types apps/web/src/lib/local-db/recurrence.test.mts
 */
import assert from "node:assert/strict";

import {
  dateInMonth,
  dayInMonth,
  daysBetween,
  daysInMonth,
  nextOccurrence,
} from "./recurrence.ts";

import type { RecurrenceRule } from "./schema.ts";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
  } catch (cause) {
    failed += 1;
    const detail = cause instanceof Error ? cause.message : String(cause);
    console.log('  FAIL  ' + name + ' - ' + detail.split('\n').slice(0,4).join(' | '));
    return;
  }
  passed += 1;
  console.log(`  ok  ${name}`);
}

function rule(over: Partial<RecurrenceRule> = {}): RecurrenceRule {
  return { frequency: "monthly", anchor: "day_of_month", dayOfMonth: 1, ...over };
}

test("month lengths, including leap years", () => {
  assert.equal(daysInMonth(2026, 2), 28);
  assert.equal(daysInMonth(2028, 2), 29);
  assert.equal(daysInMonth(2026, 1), 31);
  assert.equal(daysInMonth(2026, 4), 30);
});

test("day_of_month clamps to a short month", () => {
  assert.equal(dayInMonth(2026, 1, "day_of_month", 31), 31);
  assert.equal(dayInMonth(2026, 2, "day_of_month", 31), 28);
  assert.equal(dayInMonth(2028, 2, "day_of_month", 31), 29);
});

test("a monthly series on the 31st returns to the 31st after February", () => {
  // The regression that motivates passing dayOfMonth back in every month: a
  // naive "add one month to the clamped date" series becomes permanently the
  // 28th from February onwards.
  const rent = rule({ dayOfMonth: 31 });
  const feb = nextOccurrence("2026-01-31", rent);
  assert.equal(feb, "2026-02-28");
  assert.equal(nextOccurrence(feb, rent), "2026-03-31", "March must be the 31st again");
  assert.equal(nextOccurrence("2026-04-30", rent), "2026-05-31");
});

test("last_weekday lands on a weekday, walking back over weekends", () => {
  // May 2026: the 31st is a Sunday, so the last working day is Friday the 29th.
  assert.equal(dayInMonth(2026, 5, "last_weekday", 1), 29);
  // Feb 2026: the 28th is a Saturday -> Friday the 27th.
  assert.equal(dayInMonth(2026, 2, "last_weekday", 1), 27);
  // April 2026: the 30th is a Thursday, already a working day.
  assert.equal(dayInMonth(2026, 4, "last_weekday", 1), 30);
});

test("last_weekday never produces a weekend date", () => {
  for (let year = 2026; year <= 2030; year += 1) {
    for (let month = 1; month <= 12; month += 1) {
      const iso = dateInMonth(year, month, rule({ anchor: "last_weekday" }));
      const dow = new Date(`${iso}T00:00:00Z`).getUTCDay();
      assert.ok(dow !== 0 && dow !== 6, `${iso} is a weekend (dow ${dow})`);
      // And it must be in the right month.
      assert.equal(iso.slice(0, 7), `${year}-${String(month).padStart(2, "0")}`);
    }
  }
});

test("last_weekday is the last Friday when the month ends on a weekend", () => {
  // Every month ending Sat/Sun must still resolve inside that same month.
  for (let month = 1; month <= 12; month += 1) {
    const iso = dateInMonth(2027, month, rule({ anchor: "last_weekday" }));
    assert.equal(iso.slice(0, 7), `2027-${String(month).padStart(2, "0")}`, `${iso} escaped its month`);
  }
});

test("first_weekday stays inside its own month", () => {
  for (let year = 2026; year <= 2030; year += 1) {
    for (let month = 1; month <= 12; month += 1) {
      const iso = dateInMonth(year, month, rule({ anchor: "first_weekday" }));
      assert.equal(iso.slice(0, 7), `${year}-${String(month).padStart(2, "0")}`, `${iso} escaped its month`);
      assert.equal(new Date(`${iso}T00:00:00Z`).getUTCDay(), 1, `${iso} is not a Monday`);
    }
  }
});

test("first_weekday is never later than the 7th", () => {
  for (let month = 1; month <= 12; month += 1) {
    const day = dayInMonth(2026, month, "first_weekday", 1);
    assert.ok(day >= 1 && day <= 7, `got ${day}`);
  }
});

test("last_day is the actual last day", () => {
  assert.equal(dateInMonth(2026, 2, rule({ anchor: "last_day" })), "2026-02-28");
  assert.equal(dateInMonth(2028, 2, rule({ anchor: "last_day" })), "2028-02-29");
});

test("monthly steps roll the year over in December", () => {
  const rent = rule({ dayOfMonth: 1 });
  assert.equal(nextOccurrence("2026-12-01", rent), "2027-01-01");
});

test("weekly and daily step exactly", () => {
  assert.equal(nextOccurrence("2026-10-04", rule({ frequency: "weekly" })), "2026-10-11");
  assert.equal(nextOccurrence("2026-12-31", rule({ frequency: "daily" })), "2027-01-01");
});

test("yearly handles Feb 29", () => {
  assert.equal(nextOccurrence("2028-02-29", rule({ frequency: "yearly", dayOfMonth: 29 })), "2029-02-28");
});

test("yearly keeps the same month, not February", () => {
  // A yearly anniversary of a 15 March event is 15 March next year. Hardcoding
  // February here would silently move every annual rule onto the wrong date.
  assert.equal(nextOccurrence("2026-03-15", rule({ frequency: "yearly", dayOfMonth: 15 })), "2027-03-15");
  assert.equal(nextOccurrence("2026-12-31", rule({ frequency: "yearly", dayOfMonth: 31 })), "2027-12-31");
  assert.equal(nextOccurrence("2026-01-15", rule({ frequency: "yearly", dayOfMonth: 15 })), "2027-01-15");
});

test("yearly clamps Feb 29 only in a non-leap year", () => {
  // 2024 and 2028 are leap years; the years either side are not.
  assert.equal(nextOccurrence("2028-02-29", rule({ frequency: "yearly", dayOfMonth: 29 })), "2029-02-28");
  assert.equal(nextOccurrence("2024-02-29", rule({ frequency: "yearly", dayOfMonth: 29 })), "2025-02-28");
  // A non-leap Feb 29 rule simply advances a year.
  assert.equal(nextOccurrence("2027-02-28", rule({ frequency: "yearly", dayOfMonth: 29 })), "2028-02-29");
});

test("every monthly step moves strictly forward", () => {
  for (const anchor of ["day_of_month", "first_weekday", "last_weekday", "last_day"] as const) {
    let cursor = "2026-01-01";
    for (let i = 0; i < 24; i += 1) {
      const next = nextOccurrence(cursor, rule({ anchor, dayOfMonth: 15 }));
      assert.ok(daysBetween(cursor, next) > 0, `${anchor}: ${cursor} -> ${next} did not advance`);
      assert.equal(next.slice(0, 7) === cursor.slice(0, 7), false, `${anchor} repeated a month`);
      cursor = next;
    }
  }
});

test("daysBetween is signed and spans month boundaries", () => {
  assert.equal(daysBetween("2026-10-01", "2026-10-04"), 3);
  assert.equal(daysBetween("2026-10-04", "2026-10-01"), -3);
  assert.equal(daysBetween("2026-02-28", "2026-03-01"), 1);
  assert.equal(daysBetween("2028-02-28", "2028-03-01"), 2);
});

console.log(`\n${passed} recurrence assertions passed`);

// Throwing is what makes the harness exit non-zero. Without it a failed
// assertion only printed a line and the run still reported success, which is
// worse than no test at all.
if (failed > 0) throw new Error(`${failed} recurrence assertion(s) failed`);

