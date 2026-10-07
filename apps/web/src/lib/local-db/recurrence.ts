/**
 * Pure date arithmetic for recurrences. No database, no React — which is what
 * makes it testable, and date maths is exactly the kind of thing that reads
 * correct and is not ("rent on the 31st" silently becoming the 28th forever).
 *
 * Every date here is a `YYYY-MM-DD` calendar day with no timezone. All the maths
 * is done in UTC deliberately: using local time would shift dates by a day for
 * anyone west of UTC, which is most of the world for this bug.
 */
import type { MonthlyAnchor, RecurringFrequency, RecurrenceRule } from "./schema";

/** Days in a `year-month`, leap years included. */
export function daysInMonth(year: number, month: number): number {
  // Day 0 of the next month is the last day of this one.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function parseDay(day: string): { year: number; month: number; date: number } {
  const [year, month, date] = day.split("-").map(Number);
  return { year: year!, month: month!, date: date! };
}

/** Day of week for a date, 0 = Sunday. */
function weekday(year: number, month: number, date: number): number {
  return new Date(Date.UTC(year, month - 1, date)).getUTCDay();
}

function toIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * The day a rule lands on within a given month.
 *
 * `dayOfMonth` is passed in every time rather than read off the previous result,
 * so a February clamp cannot permanently move a series anchored to the 31st —
 * the rule remembers 31, and March gets 31 again.
 */
export function dayInMonth(
  year: number,
  month: number,
  anchor: MonthlyAnchor,
  dayOfMonth: number,
): number {
  const length = daysInMonth(year, month);

  switch (anchor) {
    case "last_day":
      return length;

    case "first_weekday": {
      // The first Monday on or before the 1st. Rolling back from the 1st rather
      // than forward from it guarantees the result never lands in the next
      // month, which would make a series "advance" twice in one step.
      let day = 1;
      while (weekday(year, month, day) !== 1) day -= 1;
      // Rolling back off the front of the month means wrapping to the previous
      // month's tail, which is still the first Monday of *this* month's week.
      return day < 1 ? day + 7 : day;
    }

    case "last_weekday": {
      // Walk back from the end of the month to the last Mon–Fri. If the tail is
      // all weekend this lands on the Friday before it, which is what "paid on
      // the last working day" is expected to do.
      let day = length;
      while (day > 1) {
        const dow = weekday(year, month, day);
        if (dow !== 0 && dow !== 6) return day;
        day -= 1;
      }
      return day;
    }

    case "day_of_month":
    default:
      return Math.min(Math.max(1, dayOfMonth), length);
  }
}

/** The rule's day in `year-month`, as a full `YYYY-MM-DD`. */
export function dateInMonth(year: number, month: number, rule: RecurrenceRule): string {
  return toIso(
    new Date(Date.UTC(year, month - 1, dayInMonth(year, month, rule.anchor, rule.dayOfMonth))),
  );
}

/**
 * The next occurrence strictly after `from`.
 *
 * For monthly rules this re-derives the date from the rule each month rather
 * than adding a fixed number of days, which is what keeps "last weekday" correct
 * across months of different lengths.
 */
export function nextOccurrence(from: string, rule: RecurrenceRule): string {
  const { year, month, date } = parseDay(from);
  const cursor = new Date(Date.UTC(year, month - 1, date));

  switch (rule.frequency) {
    case "daily":
      cursor.setUTCDate(cursor.getUTCDate() + 1);
      return toIso(cursor);

    case "weekly":
      cursor.setUTCDate(cursor.getUTCDate() + 7);
      return toIso(cursor);

    case "yearly": {
      const nextYear = year + 1;
      // Annual means the same *calendar day* next year, so the month is carried
      // over rather than assumed to be February.
      const day =
        rule.anchor === "day_of_month"
          ? Math.min(rule.dayOfMonth, daysInMonth(nextYear, month))
          : dayInMonth(nextYear, month, rule.anchor, rule.dayOfMonth);
      return toIso(new Date(Date.UTC(nextYear, month - 1, day)));
    }

    case "monthly":
    default: {
      // Step to the next month, then re-derive the day from the rule.
      let nextYear = year;
      let nextMonth = month + 1;
      if (nextMonth > 12) {
        nextMonth = 1;
        nextYear += 1;
      }
      return dateInMonth(nextYear, nextMonth, rule);
    }
  }
}

/** The rule built for a given first date, inferring the most useful anchor. */
export function ruleFromDate(
  frequency: RecurringFrequency,
  firstDate: string,
  anchor?: MonthlyAnchor,
): RecurrenceRule {
  const { date } = parseDay(firstDate);
  return {
    frequency,
    anchor: anchor ?? "day_of_month",
    dayOfMonth: date,
  };
}

/** How often a rule repeats, in words. Used in summaries and confirmations. */
export function describeRule(rule: RecurrenceRule): string {
  switch (rule.frequency) {
    case "daily":
      return "Every day";
    case "weekly":
      return "Every week";
    case "yearly":
      return "Every year";
    case "monthly":
    default:
      switch (rule.anchor) {
        case "last_day":
          return "On the last day of every month";
        case "last_weekday":
          return "On the last working day of every month";
        case "first_weekday":
          return "On the first Monday of every month";
        case "day_of_month":
        default:
          return `On day ${rule.dayOfMonth} of every month`;
      }
  }
}

/** Whole days from `from` to `to`; negative when `to` is in the past. */
export function daysBetween(from: string, to: string): number {
  const a = parseDay(from);
  const b = parseDay(to);
  const start = Date.UTC(a.year, a.month - 1, a.date);
  const end = Date.UTC(b.year, b.month - 1, b.date);
  return Math.round((end - start) / 86_400_000);
}

/**
 * The last day a series started on `startsOn` still runs for `months` months:
 * the start, plus the months, minus one day — so "for 3 months" starting
 * 15 October includes 15 Oct, 15 Nov and 15 Dec and stops before 15 Jan.
 *
 * A duration rather than a count of occurrences on purpose: the same answer
 * has to hold for weekly and monthly rules without knowing how many dates
 * fall inside the window.
 */
export function durationEnd(startsOn: string, months: number): string {
  const { year, month, date } = parseDay(startsOn);
  // The UTC epoch-day this lands on; clamping the day handles a start on the
  // 31st landing in a shorter month (31 Oct + 1 month = 30 Nov, not a spill
  // into December).
  const shifted = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = daysInMonth(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1);
  const clamped = Math.min(date, lastDay);
  const end = new Date(Date.UTC(year, month - 1 + months, clamped));
  end.setUTCDate(end.getUTCDate() - 1);
  return toIso(end);
}