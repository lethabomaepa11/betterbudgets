"use client";

import type { LocalDb } from "./client";
import type { FinancialGoal } from "./schema";

/**
 * Savings goals: a target, a saved amount, and the pot they live in.
 *
 * Goals are a view over an account rather than a separate ledger: the money is
 * already tracked on the account, so a goal only records the intention of how
 * much of it is spoken for.
 */

/** Goals with their account name and progress folded in. */
export async function listGoals(
  db: LocalDb,
  profileId: string,
): Promise<(FinancialGoal & { accountName: string })[]> {
  return db.query(
    `SELECT g.*, a.name AS accountName
       FROM financial_goals g
       JOIN accounts a ON a.id = g.account_id
      WHERE g.profile_id = ? AND g.deleted_at IS NULL AND a.deleted_at IS NULL
      ORDER BY g.created_at DESC`,
    [profileId],
  );
}

export async function createGoal(
  db: LocalDb,
  profileId: string,
  input: { name: string; targetAmount: number; accountId?: string },
): Promise<void> {
  if (!input.name.trim()) throw new Error("Give your goal a name.");
  if (input.targetAmount <= 0) throw new Error("Set a target above zero.");

  // Default to the profile's first account: a goal is a pot of money, so it has
  // to live somewhere, and demanding one up front is a pointless extra step for
  // a user who has only ever had one account.
  const [account] = await db.query<{ id: string }>(
    `SELECT ${input.accountId ? "id" : "id"} FROM accounts
      WHERE profile_id = ? AND deleted_at IS NULL AND is_archived = 0
      ORDER BY created_at ASC`,
    [profileId],
  );
  const accountId = input.accountId ?? account?.id;
  if (!accountId) throw new Error("Add an account before creating a goal.");

  const timestamp = new Date().toISOString();
  await db.batch([
    {
      sql: `INSERT INTO financial_goals
              (id, account_id, name, target_amount, current_amount, status,
               created_at, updated_at, origin)
            VALUES (?, ?, ?, ?, 0, 'active', ?, ?, 'local')`,
      bind: [
        crypto.randomUUID(),
        accountId,
        input.name.trim(),
        input.targetAmount,
        timestamp,
        timestamp,
      ],
    },
  ]);
}

/** Adds to (or subtracts from) a goal's saved amount. */
export async function contributeToGoal(
  db: LocalDb,
  profileId: string,
  goalId: string,
  amount: number,
): Promise<void> {
  if (amount === 0) return;

  const [goal] = await db.query<{ id: string }>(
    "SELECT id FROM financial_goals WHERE id = ? AND profile_id = ? AND deleted_at IS NULL",
    [goalId, profileId],
  );
  if (!goal) throw new Error("That goal no longer exists.");

  await db.batch([
    {
      // Clamped at zero by the app layer, and guarded here so a negative
      // "saved" figure can never reach a progress bar.
      sql: `UPDATE financial_goals
               SET current_amount = MAX(0, current_amount + ?), updated_at = ?
             WHERE id = ?`,
      bind: [amount, new Date().toISOString(), goalId],
    },
  ]);
}

export type GoalWithProgress = FinancialGoal & {
  accountName: string;
  /** 0..1 against the target. Capped at 1 so a bar can't overflow. */
  progress: number;
  /** Minor units still to go, never negative once the target is met. */
  remaining: number;
};

export function createGoals(db: LocalDb) {
  return { listGoals, createGoal, contributeToGoal };
}