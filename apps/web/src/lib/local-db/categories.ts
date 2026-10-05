"use client";

import type { LocalDb } from "./client";
import type { Category, CategoryGroup, CategoryKind } from "./schema";

type NewGroup = { name: string; color?: string | null };

type NewCategory = {
  name: string;
  kind: CategoryKind;
  groupId?: string | null;
  icon?: string | null;
  color?: string | null;
};

/**
 * Reads and writes for categories and their groups.
 *
 * Categories are the vocabulary a person actually thinks in ("Groceries",
 * "Rent"), which is deliberately a different axis from the account type
 * ("checking", "cash") — a category answers *what it was for*, an account answers
 * *which pocket*, and the same category can span several accounts.
 */
/**
 * Spend per category over a window, largest first.
 *
 * Uncategorised spending is included as an explicit `null`-named row rather than
 * dropped: hiding it would make the total on a report quietly disagree with the
 * dashboard, which is the kind of small untrustworthiness that makes people stop
 * believing the numbers.
 */
export async function spendingByCategory(
  db: LocalDb,
  profileId: string,
  from: string,
  before: string,
): Promise<{ categoryId: string | null; name: string; total: number; count: number }[]> {
  return db.query(
    `SELECT t.category_id AS categoryId,
            COALESCE(c.name, 'Uncategorised') AS name,
            SUM(t.amount) AS total,
            COUNT(*) AS count
       FROM transactions t
       JOIN accounts a ON a.id = t.account_id
       LEFT JOIN categories c ON c.id = t.category_id AND c.deleted_at IS NULL
      WHERE t.deleted_at IS NULL
        AND t.type = 'outflow'
        AND a.deleted_at IS NULL
        AND a.profile_id = ?
        AND t.occurred_on >= ? AND t.occurred_on < ?
      GROUP BY t.category_id
      ORDER BY total DESC`,
    [profileId, from, before],
  );
}

/**
 * Income, spend and net per month, oldest first.
 *
 * Built from a months spine rather than `GROUP BY strftime(...)`: a month with no
 * spending at all produces no row in a grouped query, which would drop it from a
 * chart and read as "we have no data" instead of "nothing was spent".
 */
export async function monthlyTrend(
  db: LocalDb,
  profileId: string,
  months: number,
): Promise<{ month: string; inflow: number; outflow: number; net: number }[]> {
  const rows = await db.query<{ month: string; inflow: number; outflow: number }>(
    `SELECT substr(t.occurred_on, 1, 7) AS month,
            COALESCE(SUM(CASE WHEN t.type = 'inflow'  THEN t.amount ELSE 0 END), 0) AS inflow,
            COALESCE(SUM(CASE WHEN t.type = 'outflow' THEN t.amount ELSE 0 END), 0) AS outflow
       FROM transactions t
       JOIN accounts a ON a.id = t.account_id
      WHERE t.deleted_at IS NULL
        AND a.deleted_at IS NULL
        AND a.profile_id = ?
      GROUP BY month`,
    [profileId],
  );

  const byMonth = new Map(rows.map((row) => [row.month, row]));
  const series: { month: string; inflow: number; outflow: number; net: number }[] = [];

  // Walk backwards from this month so gaps are filled with zeroes.
  const cursor = new Date();
  for (let back = months - 1; back >= 0; back--) {
    const month = `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, "0")}`;
    const row = byMonth.get(month);
    series.push({
      month,
      inflow: row?.inflow ?? 0,
      outflow: row?.outflow ?? 0,
      net: (row?.inflow ?? 0) - (row?.outflow ?? 0),
    });
    cursor.setUTCMonth(cursor.getUTCMonth() - 1);
  }

  return series;
}

/** Total money across every account, in minor units. */
export async function totalBalance(
  db: LocalDb,
  profileId: string,
): Promise<number> {
  const [row] = await db.query<{ total: number }>(
    `SELECT COALESCE(SUM(
              COALESCE(a.balance, 0)
              + COALESCE((SELECT SUM(CASE WHEN t.type = 'inflow'  THEN t.amount ELSE 0 END)
                             - SUM(CASE WHEN t.type = 'outflow' THEN t.amount ELSE 0 END)
                            FROM transactions t
                           WHERE t.account_id = a.id AND t.deleted_at IS NULL), 0)
            ), 0) AS total
       FROM accounts a
      WHERE a.profile_id = ? AND a.deleted_at IS NULL AND a.is_archived = 0`,
    [profileId],
  );
  return row?.total ?? 0;
}

export function createCategories(db: LocalDb) {
  return {
    /** Live categories, with their group's name denormalised in. */
    async list(profileId: string): Promise<(Category & { group_name: string | null })[]> {
      return db.query(
        `SELECT c.*, g.name AS group_name
           FROM categories c
           LEFT JOIN category_groups g ON g.id = c.group_id AND g.deleted_at IS NULL
          WHERE c.profile_id = ? AND c.deleted_at IS NULL AND c.is_archived = 0
          ORDER BY c.sort_order ASC, c.name COLLATE NOCASE ASC`,
        [profileId],
      );
    },

    /** Categories of one direction, for the transaction form's picker. */
    async listByKind(
      profileId: string,
      kind: CategoryKind,
    ): Promise<(Category & { group_name: string | null })[]> {
      return db.query(
        `SELECT c.*, g.name AS group_name
           FROM categories c
           LEFT JOIN category_groups g ON g.id = c.group_id AND g.deleted_at IS NULL
          WHERE c.profile_id = ? AND c.deleted_at IS NULL AND c.is_archived = 0
            AND c.kind = ?
          ORDER BY c.sort_order ASC, c.name COLLATE NOCASE ASC`,
        [profileId, kind],
      );
    },

    async listGroups(profileId: string): Promise<CategoryGroup[]> {
      return db.query<CategoryGroup>(
        `SELECT * FROM category_groups
          WHERE profile_id = ? AND deleted_at IS NULL
          ORDER BY sort_order ASC, name COLLATE NOCASE ASC`,
        [profileId],
      );
    },
async createGroup(profileId: string, input: NewGroup): Promise<CategoryGroup> {
      const name = input.name.trim();
      if (!name) throw new Error("Give the group a name.");

      const timestamp = new Date().toISOString();
      const group: CategoryGroup = {
        id: crypto.randomUUID(),
        profile_id: profileId,
        name,
        color: input.color ?? null,
        // New groups sort after existing ones, so ordering stays stable without
        // counting rows on every insert.
        sort_order: 0,
        created_at: timestamp,
        updated_at: timestamp,
        deleted_at: null,
        origin: "local",
      };

      await db.batch([
        {
          sql: `INSERT INTO category_groups
                  (id, profile_id, name, color, sort_order, created_at, updated_at, origin)
                VALUES (?, ?, ?, ?, ?, ?, ?, 'local')`,
          bind: [
            group.id,
            group.profile_id,
            group.name,
            group.color,
            group.sort_order,
            timestamp,
            timestamp,
          ],
        },
      ]);

      return group;
    },

    async createCategory(profileId: string, input: NewCategory): Promise<Category> {
      const name = input.name.trim();
      if (!name) throw new Error("Give the category a name.");

      // Ownership-checked rather than trusted from the caller, so a group id from
      // another profile cannot be attached to this one's category.
      if (input.groupId) {
        const [group] = await db.query<{ id: string }>(
          "SELECT id FROM category_groups WHERE id = ? AND profile_id = ? AND deleted_at IS NULL",
          [input.groupId, profileId],
        );
        if (!group) throw new Error("That group no longer exists.");
      }

      const timestamp = new Date().toISOString();
      const category: Category = {
        id: crypto.randomUUID(),
        profile_id: profileId,
        group_id: input.groupId ?? null,
        name,
        kind: input.kind,
        icon: input.icon ?? null,
        color: input.color ?? null,
        sort_order: 0,
        is_archived: 0,
        created_at: timestamp,
        updated_at: timestamp,
        deleted_at: null,
        origin: "local",
      };

      await db.batch([
        {
          sql: `INSERT INTO categories
                  (id, profile_id, group_id, name, kind, icon, color, sort_order,
                   is_archived, created_at, updated_at, origin)
                VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, 'local')`,
          bind: [
            category.id,
            category.profile_id,
            category.group_id,
            category.name,
            category.kind,
            category.icon,
            category.color,
            timestamp,
            timestamp,
          ],
        },
      ]);

      return category;
    },

    /**
     * Archives rather than deletes.
     *
     * Existing transactions keep pointing at the row — the FK is ON DELETE SET NULL
     * precisely so this cannot quietly unfile last month's spending. Archived
     * categories drop out of the pickers but their history still renders.
     */
    async archiveCategory(profileId: string, categoryId: string): Promise<void> {
      await db.batch([
        {
          sql: `UPDATE categories SET is_archived = 1, updated_at = ?
                WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
          bind: [new Date().toISOString(), categoryId, profileId],
        },
      ]);
    },

    async renameCategory(profileId: string, categoryId: string, name: string): Promise<void> {
      const trimmed = name.trim();
      if (!trimmed) throw new Error("Give the category a name.");

      await db.batch([
        {
          sql: `UPDATE categories SET name = ?, updated_at = ?
                WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
          bind: [trimmed, new Date().toISOString(), categoryId, profileId],
        },
      ]);
    },
  };
}

/**
 * The starter categories offered during onboarding.
 *
 * Deliberately a starting point rather than a template: the user keeps, renames
 * or removes whichever they want. Grouping is flat — nesting is something a power
 * user can add later, and forcing a hierarchy on someone who just wants to know
 * where their money goes is the fastest way to make them abandon the app.
 */
export const SUGGESTED_CATEGORIES: readonly { name: string; kind: CategoryKind }[] = [
  { name: "Salary", kind: "income" },
  { name: "Freelance", kind: "income" },
  { name: "Other income", kind: "income" },

  { name: "Rent", kind: "expense" },
  { name: "Electricity", kind: "expense" },
  { name: "Water", kind: "expense" },
  { name: "Internet", kind: "expense" },

  { name: "Groceries", kind: "expense" },
  { name: "Restaurants", kind: "expense" },
  { name: "Takeaway", kind: "expense" },

  { name: "Fuel", kind: "expense" },
  { name: "Public transport", kind: "expense" },
  { name: "Uber", kind: "expense" },
  { name: "Vehicle", kind: "expense" },

  { name: "Clothing", kind: "expense" },
  { name: "Entertainment", kind: "expense" },
  { name: "Subscriptions", kind: "expense" },

  { name: "Savings", kind: "expense" },
  { name: "Investments", kind: "expense" },
  { name: "Debt payments", kind: "expense" },
];

/**
 * Writes the suggested set in one batch.
 *
 * One batch rather than a loop: onboarding should feel instant, and 18 separate
 * round-trips through the worker is 18 chances to render a half-built list.
 */
export async function seedSuggestedCategories(
  db: LocalDb,
  profileId: string,
): Promise<Category[]> {
  const timestamp = new Date().toISOString();

  const categories: Category[] = SUGGESTED_CATEGORIES.map((suggestion, index) => ({
    id: crypto.randomUUID(),
    profile_id: profileId,
    group_id: null,
    name: suggestion.name,
    kind: suggestion.kind,
    icon: null,
    color: null,
    // Preserve the order above, so the picker reads the way it was presented.
    sort_order: index,
    is_archived: 0,
    created_at: timestamp,
    updated_at: timestamp,
    deleted_at: null,
    origin: "local",
  }));

  await db.batch(
    categories.map((category) => ({
      sql: `INSERT INTO categories
              (id, profile_id, group_id, name, kind, icon, color, sort_order,
               is_archived, created_at, updated_at, origin)
            VALUES (?, ?, NULL, ?, ?, NULL, NULL, ?, 0, ?, ?, 'local')`,
      bind: [
        category.id,
        category.profile_id,
        category.name,
        category.kind,
        category.sort_order,
        timestamp,
        timestamp,
      ],
    })),
  );

  return categories;
}

export function createReports(db: LocalDb) {
  return { spendingByCategory, monthlyTrend, totalBalance };
}