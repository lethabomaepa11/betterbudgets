/**
 * What to say about money that is due, and whether it is covered.
 *
 * Pure and separate from both the database and the components, because this is
 * where the judgement lives: "you can cover this" is a claim about someone's
 * finances, and a wrong one is worse than saying nothing at all.
 */
import type { OccurrenceRow } from "./occurrences";

export type Urgency = "overdue" | "today" | "soon" | "later";

export function urgencyOf(daysUntil: number): Urgency {
  if (daysUntil < 0) return "overdue";
  if (daysUntil === 0) return "today";
  if (daysUntil <= 3) return "soon";
  return "later";
}

/** "due in 3 days" / "due today" / "4 days late". */
export function duePhrase(daysUntil: number): string {
  if (daysUntil === 0) return "due today";
  if (daysUntil === 1) return "due tomorrow";
  if (daysUntil > 1) return `due in ${daysUntil} days`;
  if (daysUntil === -1) return "1 day late";
  return `${Math.abs(daysUntil)} days late`;
}

/** Short form for a badge, where "due in 3 days" will not fit. */
export function duePhraseShort(daysUntil: number): string {
  if (daysUntil === 0) return "today";
  if (daysUntil === 1) return "tomorrow";
  if (daysUntil > 1) return `${daysUntil}d`;
  return `${Math.abs(daysUntil)}d late`;
}

export type CoverAdvice = {
  /** Whether the balance covers this outflow on its own. */
  covered: boolean;
  /** Shortfall in minor units, when not covered. */
  shortBy: number;
  /** What to actually say. */
  message: string;
};

/**
 * Whether an account can cover a payment, and by how much it can't.
 *
 * Money still arriving before the due date counts toward covering it: that is the
 * whole point of a "salary lands on the 30th, rent on the 1st" arrangement, and
 * treating the salary as absent would tell someone to panic about a bill they are
 * about to be paid for.
 */
export function canCover(
  available: number,
  amount: number,
  incomingBeforeDueDate = 0,
): CoverAdvice {
  const shortBy = amount - (available + incomingBeforeDueDate);

  if (shortBy <= 0) {
    return {
      covered: true,
      shortBy: 0,
      message:
        incomingBeforeDueDate > 0
          ? "Covered once the money due in arrives."
          : "You can cover this.",
    };
  }

  return {
    covered: false,
    shortBy,
    message: "Short by the time it's due. Move money across, or pay part of it now.",
  };
}

export type DailyBriefing = {
  /** The one thing worth knowing, if there is one. */
  headline: string | null;
  /** Everything in the window, most urgent first. */
  items: OccurrenceRow[];
  /** True when at least one item needs attention in the next three days. */
  needsAttention: boolean;
  /** Net of the window against the current balance: what is left to save. */
  surplus: number;
};

/**
 * The dashboard summary.
 *
 * Ordered by urgency rather than by date on purpose: a bill three days away that
 * the balance cannot cover is the thing worth knowing about, and it is not
 * necessarily the next thing due.
 */
export function buildBriefing(
  rows: OccurrenceRow[],
  options: { balance: number; format: (minor: number) => string },
): DailyBriefing {
  const items = [...rows].sort((a, b) => a.daysUntil - b.daysUntil);
  const attention = items.filter((item) => urgencyOf(item.daysUntil) !== "later");

  let headline: string | null = null;
  if (attention.length === 1) {
    const only = attention[0];
    headline = `${only.name ?? "Something"} is ${duePhrase(only.daysUntil)}.`;
  } else if (attention.length > 1) {
    headline = `${attention.length} things need you in the next three days.`;
  }

  let incoming = 0;
  let outgoing = 0;
  for (const item of items) {
    if (item.type === "inflow") incoming += item.amount;
    else outgoing += item.amount;
  }

  return {
    headline,
    items,
    needsAttention: attention.length > 0,
    // "Save at least this much": what is left once the window's bills are paid
    // out of the balance plus everything arriving inside it.
    surplus: options.balance + incoming - outgoing,
  };
}