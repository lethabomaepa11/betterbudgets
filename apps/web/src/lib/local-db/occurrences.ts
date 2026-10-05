/**
 * Planned occurrences: money that is expected but has not moved yet.
 *
 * This is deliberately separate from `transactions`. Rent due in three days is
 * not money the user has spent, and storing it as a transaction made the
 * dashboard report a balance that was too low months before anything was paid.
 * Here it waits as a `pending` row, is shown on the dashboard as something to
 * act on, and only becomes a transaction when the user confirms it.
 *
 * Confirmation is a single batch: the occurrence row and the transaction it
 * settles into are written together, so a failure cannot leave money recorded
 * against an occurrence still asking to be paid.
 */
"use client";

import type { LocalDb } from "./client";
import type {
  MonthlyAnchor,
  OccurrenceStatus,
  PlannedOccurrence,
  RecurrenceRule,
  RecurringFrequency,
  RecurringTransaction,
  TransactionType,
} from "./schema";
import { nextOccurrence, parseDay } from "./recurrence";

/**
 * Days of slack a pending occurrence is shown on the dashboard.
 *
 * Three is the point where a reminder is useful rather than nagging: far enough
 * ahead to plan, close enough to act.
 */
export const UPCOMING_WINDOW_DAYS = 21;

export type NewRecurring = {
  accountId: string;
  categoryId?: string | null;
  name: string;
  /** Minor units, always non-negative; `type` carries the direction. */
  amount: number;
  type: TransactionType;
  frequency: RecurringFrequency;
  /** Only meaningful for `monthly`. Defaults to the first date's day number. */
  anchor?: MonthlyAnchor;
  /** First expected date, `YYYY-MM-DD`. */
  startsOn: string;
};

/** How far an edit reaches. The choice is the user's, not a default. */
export type EditScope =
  /**
   * Everything still pending, including the next one due.
   *
   * The right default for a correction: nobody wants to see £1200 on the
   * dashboard and have an edit leave it there because the bill is due tomorrow.
   */
  | "future"
  /**
   * Everything except the next payment still waiting to be confirmed.
   *
   * For "I have already agreed to pay this one" — the imminent payment keeps the
   * terms that were agreed, and everything after it takes the new ones.
   */
  | "after_next";

/** The parts of a rule that can be changed. All optional: only what is sent moves. */
export type RuleChanges = {
  name?: string;
  /** Minor units. */
  amount?: number;
  accountId?: string;
  categoryId?: string | null;
  frequency?: RecurringFrequency;
  anchor?: MonthlyAnchor;
  /** Re-anchors the series from this date. */
  startsOn?: string;
};

/**
 * Which pending occurrences an edit touches, and what happens to each.
 *
 * Split out from `updateRule` because this is where the subtlety lives and it
 * is worth testing without a database:
 *
 * - An occurrence on a date the new rule never produces has to be retired. Left
 *   standing, it would sit on the dashboard forever asking to be paid for a date
 *   that is no longer part of the series.
 * - Under `after_next`, the earliest one is skipped even though it matches, so
 *   the payment the user has already agreed to keeps its original terms.
 */
export function planOccurrenceEdit(
  pending: readonly PlannedOccurrence[],
  wantedDates: ReadonlySet<string>,
  scope: EditScope,
): {
  /** Rewrite these with the new terms. */
  keep: PlannedOccurrence[];
  /** Tombstone: the date is no longer a due date. */
  retire: PlannedOccurrence[];
  /** Leave entirely alone under `after_next`. */
  preserve: PlannedOccurrence[];
} {
  // Taken by due date rather than by row order, so a stale row cannot make the
  // wrong payment the protected one.
  const byDate = [...pending].sort((a, b) => a.due_on.localeCompare(b.due_on));
  const protectedId = scope === "after_next" && byDate[0] ? byDate[0].id : null;

  const keep: PlannedOccurrence[] = [];
  const retire: PlannedOccurrence[] = [];
  const preserve: PlannedOccurrence[] = [];

  for (const row of byDate) {
    // Settled rows are history: `paid` records what the user actually spent and
    // `skipped` records a decision they made. An edit must not reach either, even
    // if a caller passes them by mistake.
    if (row.status !== "pending") continue;

    if (row.id === protectedId) {
      preserve.push(row);
      continue;
    }
    (wantedDates.has(row.due_on) ? keep : retire).push(row);
  }

  return { keep, retire, preserve };
}

/**
 * The dates a rule produces, starting at `startsOn`, out to `limit`.
 *
 * Bounded by a guard rather than a target count, because a `daily` rule walks a
 * date a day at a time — counting iterations instead of miles would either
 * produce a handful of days for the wrong frequency or spin.
 */
export function datesForRule(from: string, rule: RecurrenceRule, limit = 200): Set<string> {
  const wanted = new Set<string>();
  let cursor = from;
  for (let guard = 0; guard < limit; guard += 1) {
    wanted.add(cursor);
    cursor = nextOccurrence(cursor, rule);
  }
  return wanted;
}

/** What an edit actually did, so the screen can say what happened. */
export type UpdateResult = {
  /** Pending occurrences rewritten with the new terms. */
  updated: number;
  /** Pending occurrences retired: their date is no longer a due date at all. */
  removed: number;
  /** Fresh occurrences generated for the new dates. */
  added: number;
  /** Left alone under `after_next`: the payment the user has already agreed to. */
  preserved: number;
};

/**
 * Changes a rule and brings its pending occurrences into line.
 *
 * The interesting part is the occurrence window, not the rule row. Occurrences
 * were materialised under the old terms, so updating only the rule would leave
 * the dashboard asking for £1200 for months after the user corrected it to
 * £1250. So the window is rewritten with it.
 *
 * Deliberately never touched:
 *
 * - Anything already `paid` or `skipped`. Those became history, and rewriting
 *   them would change what the user actually paid.
 * - The imminent payment under `after_next`. Someone who has already agreed
 *   £1200 for this month needs this month's payment to stay £1200.
 *
 * The rule and its occurrences are written in one batch. A partial write here
 * would leave a rule whose stated amount disagreeing with what the dashboard
 * asks for, which is worse than either the old or the new figure.
 */
export async function updateRule(
  db: LocalDb,
  profileId: string,
  ruleId: string,
  changes: RuleChanges,
  scope: EditScope = "future",
): Promise<UpdateResult> {
  const [rule] = await db.query<RecurringTransaction>(
    `SELECT * FROM recurring_transactions
      WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    [ruleId, profileId],
  );
  if (!rule) throw new Error("That repeating item no longer exists.");

  const name = changes.name ?? rule.name;
  const amount = changes.amount ?? rule.amount;
  const accountId = changes.accountId ?? rule.account_id;
  const categoryId = changes.categoryId === undefined ? rule.category_id : changes.categoryId;
  const frequency = changes.frequency ?? rule.frequency;
  const anchor = changes.anchor ?? rule.anchor;
  const startsOn = changes.startsOn ?? rule.next_due_date;
  const dayOfMonth = parseDay(startsOn).date;

  const pending = await db.query<PlannedOccurrence>(
    `SELECT * FROM planned_occurrences
      WHERE rule_id = ? AND status = 'pending' AND deleted_at IS NULL
      ORDER BY due_on ASC`,
    [ruleId],
  );

  const timestamp = nowIso();
  const recurrenceRule = { frequency, anchor, dayOfMonth };
  const wanted = datesForRule(startsOn, recurrenceRule);
  const { keep, retire, preserve } = planOccurrenceEdit(pending, wanted, scope);

  const statements: { sql: string; bind: readonly (string | number | null)[] }[] = [
    {
      sql: `UPDATE recurring_transactions
               SET name = ?, amount = ?, account_id = ?, category_id = ?,
                   frequency = ?, anchor = ?, day_of_month = ?,
                   next_due_date = ?, updated_at = ?
             WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
      bind: [
        name,
        amount,
        accountId,
        categoryId,
        frequency,
        anchor,
        dayOfMonth,
        startsOn,
        timestamp,
        ruleId,
        profileId,
      ],
    },
  ];

  let updated = 0;
  let removed = 0;

  for (const row of retire) {
    // The date is no longer a due date, so nothing would ever come of it.
    // Tombstoned rather than deleted, like everything else in this schema.
    statements.push({
      sql: `UPDATE planned_occurrences
             SET deleted_at = ?, updated_at = ?
           WHERE id = ? AND status = 'pending' AND deleted_at IS NULL`,
      bind: [timestamp, timestamp, row.id],
    });
    removed += 1;
  }

  for (const row of keep) {
    statements.push({
      sql: `UPDATE planned_occurrences
             SET account_id = ?, category_id = ?, name = ?, amount = ?, updated_at = ?
           WHERE id = ? AND status = 'pending' AND deleted_at IS NULL`,
      bind: [accountId, categoryId, name, amount, timestamp, row.id],
    });
    updated += 1;
  }

  await db.batch(statements);

  // Runs after the batch so it reads the new rule. It only adds dates the batch
  // did not cover — the ones just written are already matched, and `preserve`
  // keeps its own dates and terms regardless.
  const added = await syncRule(db, profileId, ruleId, startsOn);

  return { updated, removed, added, preserved: preserve.length };
}

function nowIso() {
  return new Date().toISOString();
}

function plusDays(day: string, count: number): string {
  const { year, month, date } = parseDay(day);
  const cursor = new Date(Date.UTC(year, month - 1, date));
  cursor.setUTCDate(cursor.getUTCDate() + count);
  return cursor.toISOString().slice(0, 10);
}

/** Whole days from `from` to `to`, negative when overdue. */
function dayCount(from: string, to: string): number {
  const a = parseDay(from);
  const b = parseDay(to);
  return Math.round(
    (Date.UTC(b.year, b.month - 1, b.date) - Date.UTC(a.year, a.month - 1, a.date)) / 86_400_000,
  );
}

/** A pending occurrence plus the names the dashboard needs to render it. */
export type OccurrenceRow = PlannedOccurrence & {
  accountName: string;
  categoryName: string | null;
  /** Whole days from today: negative when already overdue. */
  daysUntil: number;
  /** The human phrasing, e.g. "Every month". */
  frequencyLabel: string | null;
};

function describeFrequency(frequency: RecurringFrequency, anchor: string | null): string {
  if (frequency === "daily") return "Every day";
  if (frequency === "weekly") return "Every week";
  if (frequency === "yearly") return "Every year";
  switch (anchor) {
    case "last_day":
      return "Last day of the month";
    case "last_weekday":
      return "Last working day of the month";
    case "first_weekday":
      return "First Monday of the month";
    default:
      return "Every month";
  }
}

/**
 * Pending occurrences, soonest first.
 *
 * Overdue items are included and sort ahead of everything else, because the one
 * someone most needs to act on is the one already late.
 */
export async function listUpcoming(
  db: LocalDb,
  profileId: string,
  from: string,
  windowDays = UPCOMING_WINDOW_DAYS,
): Promise<OccurrenceRow[]> {
  const horizon = plusDays(from, windowDays);
  const rows = await db.query<
    Omit<OccurrenceRow, "daysUntil" | "frequencyLabel"> & {
      ruleFrequency: RecurringFrequency | null;
      ruleAnchor: string | null;
    }
  >(
    `SELECT p.*,
            a.name AS accountName,
            c.name AS categoryName,
            r.frequency AS ruleFrequency,
            r.anchor   AS ruleAnchor
       FROM planned_occurrences p
       JOIN accounts a ON a.id = p.account_id AND a.deleted_at IS NULL
       LEFT JOIN categories c ON c.id = p.category_id
       LEFT JOIN recurring_transactions r ON r.id = p.rule_id
      WHERE p.profile_id = ?
        AND p.status = 'pending'
        AND p.deleted_at IS NULL
        AND p.due_on <= ?
      ORDER BY p.due_on ASC`,
    [profileId, horizon],
  );

  return rows.map((row) => ({
    ...row,
    daysUntil: dayCount(from, row.due_on),
    frequencyLabel: row.ruleFrequency ? describeFrequency(row.ruleFrequency, row.ruleAnchor) : null,
  }));
}

/**
 * Everything pending in the window, split by direction.
 *
 * This is what lets the dashboard answer "can I cover this?" without a second
 * round trip per card.
 */
export async function summariseUpcoming(
  db: LocalDb,
  profileId: string,
  from: string,
): Promise<{ incoming: number; outgoing: number; rows: OccurrenceRow[] }> {
  const rows = await listUpcoming(db, profileId, from);

  let incoming = 0;
  let outgoing = 0;
  for (const row of rows) {
    if (row.type === "inflow") incoming += row.amount;
    else outgoing += row.amount;
  }

  return { incoming, outgoing, rows };
}

/** Occurrences for one profile, any status, newest first. */
export async function listOccurrences(
  db: LocalDb,
  profileId: string,
  status?: OccurrenceStatus,
): Promise<PlannedOccurrence[]> {
  const filter = status ? "AND status = ?" : "";
  const bind = status ? [profileId, status] : [profileId];
  return db.query<PlannedOccurrence>(
    `SELECT * FROM planned_occurrences
      WHERE profile_id = ? AND deleted_at IS NULL ${filter}
      ORDER BY due_on DESC`,
    bind,
  );
}

/** Whether anything still needs a decision. Drives the dashboard badge. */
export async function hasPending(db: LocalDb, profileId: string): Promise<boolean> {
  const [row] = await db.query<{ count: number }>(
    `SELECT COUNT(*) AS count FROM planned_occurrences
      WHERE profile_id = ? AND status = 'pending' AND deleted_at IS NULL`,
    [profileId],
  );
  return (row?.count ?? 0) > 0;
}

/**
 * Marks an occurrence as dealt with without moving money.
 *
 * Distinct from `confirmOccurrence`: skipping leaves no transaction, so the
 * balance and the spending report are untouched. That difference is the whole
 * reason both exist.
 */
export async function skipOccurrence(
  db: LocalDb,
  profileId: string,
  occurrenceId: string,
): Promise<void> {
  const timestamp = nowIso();
  await db.batch([
    {
      sql: `UPDATE planned_occurrences
             SET status = 'skipped', settled_on = ?, updated_at = ?
           WHERE id = ? AND profile_id = ? AND status = 'pending' AND deleted_at IS NULL`,
      bind: [timestamp, timestamp, occurrenceId, profileId],
    },
  ]);
}

/** A rule as the management screen shows it, with the next thing it will ask for. */
export type RuleRow = {
  id: string;
  name: string | null;
  amount: number | null;
  type: TransactionType | null;
  accountId: string | null;
  accountName: string | null;
  /** Needed by the edit form: the name alone cannot identify a row. */
  categoryId: string | null;
  categoryName: string | null;
  frequency: RecurringFrequency;
  anchor: MonthlyAnchor;
  dayOfMonth: number;
  isActive: number;
  nextDueDate: string;
  /** Pending occurrences this rule still owes, for the "3 coming up" line. */
  pending: number;
  /** True when the rule predates v5 and has no template to generate from. */
  incomplete: boolean;
};

/** Every rule for a profile, active first, then by how soon it is due. */
export async function listRules(db: LocalDb, profileId: string): Promise<RuleRow[]> {
  const rows = await db.query<Omit<RuleRow, "incomplete">>(
    `SELECT r.id, r.name, r.amount, r.tx_type AS type, r.account_id AS accountId,
            a.name AS accountName, r.category_id AS categoryId, c.name AS categoryName,
            r.frequency, r.anchor, r.day_of_month AS dayOfMonth,
            r.is_active AS isActive, r.next_due_date AS nextDueDate,
            (SELECT COUNT(*) FROM planned_occurrences p
              WHERE p.rule_id = r.id AND p.status = 'pending' AND p.deleted_at IS NULL) AS pending
       FROM recurring_transactions r
       LEFT JOIN accounts a ON a.id = r.account_id
       LEFT JOIN categories c ON c.id = r.category_id
      WHERE r.profile_id = ? AND r.deleted_at IS NULL
      ORDER BY r.is_active DESC, r.next_due_date ASC`,
    [profileId],
  );

  return rows.map((row) => ({
    ...row,
    // Matches the guard in syncRule: a rule with no template cannot generate
    // anything, and saying so is better than showing a date that never arrives.
    incomplete: !row.accountId || row.name === null || row.amount === null || !row.type,
  }));
}

/**
 * Stops a rule generating anything further.
 *
 * `is_active` rather than deleting, because the occurrences already generated
 * stay on the dashboard until they are paid or skipped, and the paid history
 * stays attached to this rule. Deleting the row instead would orphan both.
 *
 * Occurrences already in flight are left alone deliberately: someone pausing rent
 * because they moved out still has to pay this month's rent.
 */
export async function setRuleActive(
  db: LocalDb,
  profileId: string,
  ruleId: string,
  isActive: boolean,
): Promise<void> {
  const timestamp = nowIso();
  await db.batch([
    {
      sql: `UPDATE recurring_transactions
             SET is_active = ?, updated_at = ?
           WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
      bind: [isActive ? 1 : 0, timestamp, ruleId, profileId],
    },
  ]);
}

/**
 * Removes a rule and everything still pending for it.
 *
 * Distinct from pausing: this is for a rule that was a mistake. Occurrences are
 * tombstoned rather than deleted so the same table still holds no rows a sync
 * could resurrect.
 */
export async function deleteRule(
  db: LocalDb,
  profileId: string,
  ruleId: string,
): Promise<void> {
  const timestamp = nowIso();
  await db.batch([
    {
      sql: `UPDATE planned_occurrences
             SET deleted_at = ?, updated_at = ?
           WHERE rule_id = ? AND profile_id = ? AND deleted_at IS NULL`,
      bind: [timestamp, timestamp, ruleId, profileId],
    },
    {
      sql: `UPDATE recurring_transactions
             SET deleted_at = ?, is_active = 0, updated_at = ?
           WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
      bind: [timestamp, timestamp, ruleId, profileId],
    },
  ]);
}

/**
 * Records money as having moved, and closes the occurrence.
 *
 * The two writes share one batch, so an occurrence can never be marked paid
 * without the transaction existing. The `status = 'pending'` guard is what makes
 * a double-tap or a second tab harmless: the second call matches no rows and
 * does nothing rather than paying twice.
 */
export async function confirmOccurrence(
  db: LocalDb,
  profileId: string,
  occurrenceId: string,
  paidOn: string,
  amountMinor?: number,
): Promise<PlannedOccurrence> {
  const [existing] = await db.query<PlannedOccurrence>(
    `SELECT * FROM planned_occurrences
      WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    [occurrenceId, profileId],
  );
  if (!existing) throw new Error("That item is no longer waiting for you.");
  if (existing.status !== "pending") {
    throw new Error("You have already dealt with this one.");
  }

  const timestamp = nowIso();
  // Dated to the due date rather than the day of confirmation, so a bill paid a
  // couple of days late still lands in the month it belongs to. A date that has
  // already passed (confirming something overdue) uses today instead, since
  // back-dating a payment into the past would distort that month's totals.
  const occurredOn = existing.due_on <= paidOn ? existing.due_on : paidOn;
  const amount = amountMinor ?? existing.amount;
  const transactionId = crypto.randomUUID();

  await db.batch([
    {
      sql: `INSERT INTO transactions
              (id, account_id, source_account_id, name, amount, type, is_allowance,
               occurred_on, category_id, notes, recurring_id, created_at, updated_at, origin)
            VALUES (?, ?, NULL, ?, ?, ?, 0, ?, ?, NULL, ?, ?, ?, 'local')`,
      bind: [
        transactionId,
        existing.account_id,
        existing.name,
        amount,
        existing.type,
        occurredOn,
        existing.category_id,
        existing.rule_id,
        timestamp,
        timestamp,
      ],
    },
    {
      sql: `UPDATE planned_occurrences
             SET status = 'paid', paid_transaction_id = ?, settled_on = ?, updated_at = ?
           WHERE id = ? AND status = 'pending'`,
      bind: [transactionId, occurredOn, timestamp, occurrenceId],
    },
    {
      sql: `INSERT INTO outbox (operation_id, entity, entity_id, op, payload, created_at)
            VALUES (?, 'transactions', ?, 'upsert', ?, ?)`,
      bind: [
        crypto.randomUUID(),
        transactionId,
        JSON.stringify({
          id: transactionId,
          account_id: existing.account_id,
          name: existing.name,
          amount,
          type: existing.type,
          occurred_on: occurredOn,
          category_id: existing.category_id,
          recurring_id: existing.rule_id,
        }),
        timestamp,
      ],
    },
  ]);

  return {
    ...existing,
    status: "paid",
    paid_transaction_id: transactionId,
    settled_on: occurredOn,
  };
}

/**
 * Creates a recurrence and materialises a rolling window of occurrences.
 *
 * Two deliberate choices:
 *
 * 1. Occurrences go into `planned_occurrences`, not `transactions`. They are
 *    expectations until the user confirms them.
 * 2. A window is generated rather than a fixed number of rows, and `syncRule`
 *    tops it up. An unbounded series would be an unbounded table; a fixed one
 *    would run out and quietly stop reminding someone about rent.
 */
export async function createRecurring(
  db: LocalDb,
  profileId: string,
  input: NewRecurring,
): Promise<{ ruleId: string; generated: number }> {
  const [account] = await db.query<{ id: string }>(
    `SELECT id FROM accounts
      WHERE id = ? AND profile_id = ? AND deleted_at IS NULL AND is_archived = 0`,
    [input.accountId, profileId],
  );
  if (!account) throw new Error("That account does not belong to this profile.");

  if (input.categoryId) {
    const [category] = await db.query<{ id: string; kind: "income" | "expense" }>(
      `SELECT id, kind FROM categories
        WHERE id = ? AND profile_id = ? AND deleted_at IS NULL AND is_archived = 0`,
      [input.categoryId, profileId],
    );
    if (!category) throw new Error("That category does not belong to this profile.");
    const expectedKind = input.type === "inflow" ? "income" : "expense";
    if (category.kind !== expectedKind) {
      throw new Error("That category does not match the recurring money direction.");
    }
  }

  const ruleId = crypto.randomUUID();
  const timestamp = nowIso();
  const { date } = parseDay(input.startsOn);
  const anchor = input.anchor ?? "day_of_month";

  await db.batch([
    {
      sql: `INSERT INTO recurring_transactions
              (id, transaction_id, profile_id, frequency, anchor, day_of_month, is_active,
               next_due_date, account_id, category_id, name, amount, tx_type,
               created_at, updated_at, origin)
            VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, 'local')`,
      bind: [
        ruleId,
        // No transaction yet — that is the point. Occurrences are only written
        // once the user confirms one, so this stays null and the rule is
        // self-contained.
        null,
        profileId,
        input.frequency,
        anchor,
        date,
        input.startsOn,
        input.accountId,
        input.categoryId ?? null,
        input.name,
        input.amount,
        input.type,
        timestamp,
        timestamp,
      ],
    },
  ]);

  const generated = await syncRule(db, profileId, ruleId);
  return { ruleId, generated };
}

/** How many days of occurrences to keep generated ahead of today. */
export const OCCURRENCE_HORIZON_DAYS = 45;

/**
 * Tops a rule's occurrence window up to the horizon.
 *
 * Idempotent by construction: the partial unique index on
 * `(rule_id, due_on)` means a second call over the same dates is rejected rather
 * than duplicated, and `INSERT OR IGNORE` turns that rejection into a no-op. So
 * this is safe to run on every app start, which is what keeps the window full
 * without a background scheduler.
 */
export async function syncRule(
  db: LocalDb,
  profileId: string,
  ruleId: string,
  from?: string,
): Promise<number> {
  const [rule] = await db.query<RecurringTransaction>(
    `SELECT * FROM recurring_transactions
      WHERE id = ? AND profile_id = ? AND deleted_at IS NULL AND is_active = 1`,
    [ruleId, profileId],
  );
  if (!rule) return 0;

  // A v4 rule has no template columns; it cannot generate anything without them.
  if (!rule.account_id || rule.name === null || rule.amount === null || !rule.tx_type) return 0;

  const recurrenceRule = {
    frequency: rule.frequency,
    anchor: rule.anchor,
    dayOfMonth: rule.day_of_month,
  };

  const today = from ?? todayLocal();
  const horizon = plusDays(today, OCCURRENCE_HORIZON_DAYS);
  const timestamp = nowIso();

  // Existing dates, so the loop can skip rather than rely on the constraint.
  const existing = await db.query<{ due_on: string }>(
    `SELECT due_on FROM planned_occurrences
      WHERE rule_id = ? AND deleted_at IS NULL`,
    [ruleId],
  );
  const seen = new Set(existing.map((row) => row.due_on));

  let cursor = rule.next_due_date > today ? rule.next_due_date : today;
  // Not `Parameters<LocalDb["batch"]>[0]`: that is a readonly array, and this
  // list is built up before the single batch call that applies it.
  const statements: { sql: string; bind: readonly (string | number | null)[] }[] = [];
  let inserted = 0;

  // Bounded as a backstop: a daily rule over a 45-day horizon needs ~45 rows,
  // and anything wildly beyond that means the horizon maths is wrong.
  for (let guard = 0; guard < 400 && cursor <= horizon; guard += 1) {
    if (!seen.has(cursor)) {
      statements.push({
        sql: `INSERT OR IGNORE INTO planned_occurrences
                (id, rule_id, profile_id, account_id, category_id, name, amount, type,
                 due_on, status, paid_transaction_id, settled_on,
                 created_at, updated_at, origin)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, NULL, ?, ?, 'local')`,
        bind: [
          crypto.randomUUID(),
          ruleId,
          profileId,
          rule.account_id,
          rule.category_id,
          rule.name,
          rule.amount,
          rule.tx_type,
          cursor,
          timestamp,
          timestamp,
        ],
      });
      inserted += 1;
    }
    cursor = nextOccurrence(cursor, recurrenceRule);
  }

  if (inserted > 0) await db.batch(statements);

  return inserted;
}

function todayLocal(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate(),
  ).padStart(2, "0")}`;
}

/**
 * Tops up every active rule. Safe to call on each app start.
 *
 * Rules whose account has been deleted are skipped rather than repaired: the
 * user removed the pocket, and quietly recreating occurrences for it would
 * resurrect something they deleted on purpose.
 */
export async function syncAllRules(db: LocalDb, profileId: string): Promise<number> {
  const rules = await db.query<{ id: string }>(
    `SELECT id FROM recurring_transactions
      WHERE profile_id = ? AND deleted_at IS NULL AND is_active = 1`,
    [profileId],
  );

  let inserted = 0;
  for (const rule of rules) {
    inserted += await syncRule(db, profileId, rule.id);
  }
  return inserted;
}