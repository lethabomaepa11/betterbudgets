"use client";

import type { LocalDb } from "./client";
import type { Budget, BudgetItem, BudgetPeriod } from "./schema";

type NewBudget = {
  name?: string | null;
  period: BudgetPeriod;
  /** First day of the period, `YYYY-MM-DD`. */
  startsOn: string;
  /** One limit per category, in minor units. */
  items: { categoryId: string; limitAmount: number }[];
};

/** A raw budget line joined with its spend, straight from the query. */
export type BudgetRow = BudgetItem & {
  category_name: string;
  category_color: string | null;
  spent: number;
};

/** A budget line with everything a progress bar needs. */
export type BudgetLine = {
  item: BudgetItem;
  categoryName: string;
  categoryColor: string | null;
  spent: number;
  /** `limit - spent`. Negative when over. */
  remaining: number;
  /** `spent / limit` as 0..n. */
  used: number;
  state: "healthy" | "approaching" | "over";
};

export type BudgetWithProgress = {
  budget: Budget;
  lines: BudgetLine[];
  /** Sum of every line's limit. */
  budgeted: number;
  /** Sum of every line's spend. */
  spent: number;
};

/**
 * "Approaching" is 80% consumed — the last point at which changing behaviour still
 * helps. Framed as information rather than as a warning on purpose: the spec asks
 * for neutral language, so nothing here says "failed" or "blown".
 */
const APPROACHING_AT = 0.8;

/** First instant of the period *after* the one starting on `day`. */
function nextPeriodStart(day: string, period: BudgetPeriod): string {
  const [year, month, date] = day.split("-").map(Number);
  const start =
    period === "weekly"
      ? new Date(Date.UTC(year!, month! - 1, date! + 7))
      : new Date(Date.UTC(year!, month!, 1));
  return start.toISOString().slice(0, 10);
}

/**
 * Reads and writes for budgets.
 *
 * A budget is a *period* owning one limit per category. Spend is never stored —
 * it is summed from `transactions` at read time, because a stored running total
 * is a second source of truth that drifts the moment a transaction is edited,
 * archived, or synced in from another device.
 */
export function createBudgets(db: LocalDb) {
  return {
    async list(profileId: string): Promise<Budget[]> {
      return db.query<Budget>(
        `SELECT * FROM budgets
          WHERE profile_id = ? AND deleted_at IS NULL
          ORDER BY starts_on DESC`,
        [profileId],
      );
    },

    async get(profileId: string, budgetId: string): Promise<Budget> {
      const [budget] = await db.query<Budget>(
        "SELECT * FROM budgets WHERE id = ? AND profile_id = ? AND deleted_at IS NULL",
        [budgetId, profileId],
      );
      if (!budget) throw new Error("That budget no longer exists.");
      return budget;
    },

    /** Lines with their spend, joined in one read. */
    async lines(profileId: string, budgetId: string): Promise<BudgetRow[]> {
      const budget = await this.get(profileId, budgetId);
      return db.query<BudgetRow>(
        `SELECT bi.*, c.name AS category_name, c.color AS category_color,
                COALESCE((
                  SELECT SUM(t.amount)
                    FROM transactions t
                    JOIN accounts a ON a.id = t.account_id
                   WHERE t.category_id = bi.category_id
                     AND t.type = 'outflow'
                     AND t.deleted_at IS NULL
                     AND a.deleted_at IS NULL
                     AND a.profile_id = ?
                     AND t.occurred_on >= ? AND t.occurred_on < ?
                ), 0) AS spent
           FROM budget_items bi
           JOIN categories c ON c.id = bi.category_id
          WHERE bi.budget_id = ? AND bi.deleted_at IS NULL AND c.deleted_at IS NULL
          ORDER BY c.name COLLATE NOCASE ASC`,
        [
          profileId,
          budget.starts_on,
          nextPeriodStart(budget.starts_on, budget.period),
          budgetId,
        ],
      );
    },

    /** A budget and its lines, with progress folded in for the progress bars. */
    async withProgress(
      profileId: string,
      budgetId: string,
    ): Promise<BudgetWithProgress> {
      const budget = await this.get(profileId, budgetId);
      const rows = await this.lines(profileId, budgetId);

      const lines: BudgetLine[] = rows.map((row) => {
        const used = row.limit_amount === 0 ? 0 : row.spent / row.limit_amount;
        return {
          item: row,
          categoryName: row.category_name,
          categoryColor: row.category_color,
          spent: row.spent,
          remaining: row.limit_amount - row.spent,
          used,
          state:
            row.spent > row.limit_amount
              ? "over"
              : used >= APPROACHING_AT
                ? "approaching"
                : "healthy",
        };
      });

      return {
        budget,
        lines,
        budgeted: lines.reduce((sum, line) => sum + line.item.limit_amount, 0),
        spent: lines.reduce((sum, line) => sum + line.spent, 0),
      };
    },
  };
}

/**
 * Creates a budget with its limits.
 *
 * The budget and every item go in one batch so a half-created budget — limits
 * with no period, or a period with no limits — is not a state the UI can reach.
 */
export async function createBudget(
  db: LocalDb,
  profileId: string,
  input: NewBudget,
): Promise<Budget> {
  if (input.items.length === 0) {
    throw new Error("Give at least one category a limit.");
  }

  // Ownership-checked: a budget must not be able to point at another profile's
  // category. The placeholders are generated from the list length, so the values
  // themselves are still bound rather than interpolated.
  const ids = input.items.map((item) => item.categoryId);
  const owned = await db.query<{ id: string }>(
    `SELECT id FROM categories
      WHERE profile_id = ? AND deleted_at IS NULL
        AND id IN (${ids.map(() => "?").join(",")})`,
    [profileId, ...ids],
  );
  if (owned.length !== ids.length) {
    throw new Error("One of those categories no longer exists.");
  }

  const timestamp = new Date().toISOString();
  const budget: Budget = {
    id: crypto.randomUUID(),
    profile_id: profileId,
    name: input.name?.trim() || null,
    period: input.period,
    starts_on: input.startsOn,
    created_at: timestamp,
    updated_at: timestamp,
    deleted_at: null,
    origin: "local",
  };

  await db.batch([
    {
      sql: `INSERT INTO budgets
              (id, profile_id, name, period, starts_on, created_at, updated_at, origin)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'local')`,
      bind: [
        budget.id,
        budget.profile_id,
        budget.name,
        budget.period,
        budget.starts_on,
        timestamp,
        timestamp,
      ],
    },
    ...input.items.map((item) => ({
      sql: `INSERT INTO budget_items
              (id, budget_id, category_id, limit_amount, created_at, updated_at, origin)
            VALUES (?, ?, ?, ?, ?, ?, 'local')`,
      bind: [
        crypto.randomUUID(),
        budget.id,
        item.categoryId,
        item.limitAmount,
        timestamp,
        timestamp,
      ],
    })),
  ]);

  return budget;
}

/**
 * Sets one category's limit, replacing any existing line.
 *
 * An upsert rather than a second row: the UNIQUE (budget_id, category_id)
 * constraint would otherwise reject the duplicate, and "remove the limit" has to
 * stay expressible, which a NOT NULL column cannot offer.
 */
export async function setBudgetLimit(
  db: LocalDb,
  profileId: string,
  budgetId: string,
  categoryId: string,
  limitAmount: number,
): Promise<void> {
  await assertOwnsBudget(db, profileId, budgetId);

  const timestamp = new Date().toISOString();
  await db.batch([
    {
      sql: `INSERT INTO budget_items
              (id, budget_id, category_id, limit_amount, created_at, updated_at, origin)
            VALUES (?, ?, ?, ?, ?, ?, 'local')
            ON CONFLICT (budget_id, category_id)
            DO UPDATE SET limit_amount = excluded.limit_amount,
                          updated_at = excluded.updated_at,
                          deleted_at = NULL`,
      bind: [
        crypto.randomUUID(),
        budgetId,
        categoryId,
        limitAmount,
        timestamp,
        timestamp,
      ],
    },
  ]);
}

/** Drops a limit. The category and its transactions are untouched. */
export async function removeBudgetLimit(
  db: LocalDb,
  profileId: string,
  budgetId: string,
  categoryId: string,
): Promise<void> {
  await assertOwnsBudget(db, profileId, budgetId);
  const timestamp = new Date().toISOString();

  await db.batch([
    {
      sql: `UPDATE budget_items SET deleted_at = ?, updated_at = ?
            WHERE budget_id = ? AND category_id = ? AND deleted_at IS NULL`,
      bind: [timestamp, timestamp, budgetId, categoryId],
    },
  ]);
}

/** The budget covering `day`, if any. Powers "am I on track right now". */
export async function currentBudget(
  db: LocalDb,
  profileId: string,
  day: string,
): Promise<BudgetWithProgress | null> {
  const [budget] = await db.query<Budget>(
    `SELECT * FROM budgets
      WHERE profile_id = ? AND deleted_at IS NULL AND starts_on <= ?
      ORDER BY starts_on DESC
      LIMIT 1`,
    [profileId, day],
  );
  if (!budget) return null;
  return budgetWithProgress(db, profileId, budget.id);
}

async function assertOwnsBudget(db: LocalDb, profileId: string, budgetId: string) {
  const [budget] = await db.query<Budget>(
    "SELECT id FROM budgets WHERE id = ? AND profile_id = ? AND deleted_at IS NULL",
    [budgetId, profileId],
  );
  if (!budget) throw new Error("That budget no longer exists.");
}

async function budgetWithProgress(
  db: LocalDb,
  profileId: string,
  budgetId: string,
): Promise<BudgetWithProgress> {
  const { withProgress } = createBudgets(db);
  return withProgress(profileId, budgetId);
}