"use client";

import type { LocalDb } from "./client";
import type { FinancialGoal } from "./schema";

function outbox(entity: string, id: string, payload: unknown) {
  return {
    sql: `INSERT INTO outbox (operation_id, entity, entity_id, op, payload, created_at)
          VALUES (?, ?, ?, 'upsert', ?, ?)`,
    bind: [crypto.randomUUID(), entity, id, JSON.stringify(payload), new Date().toISOString()],
  };
}

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
): Promise<(FinancialGoal & {
  accountName: string;
  recommendationTitle: string | null;
  recommendationDescription: string | null;
})[]> {
  return db.query(
    `SELECT g.*, a.name AS accountName,
              (SELECT r.title FROM goal_recommendations r
                WHERE r.goal_id = g.id AND r.deleted_at IS NULL
                ORDER BY r.created_at DESC LIMIT 1) AS recommendationTitle,
              (SELECT r.description FROM goal_recommendations r
                WHERE r.goal_id = g.id AND r.deleted_at IS NULL
                ORDER BY r.created_at DESC LIMIT 1) AS recommendationDescription
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
  input: {
    name: string;
    targetAmount: number;
    accountId?: string;
    targetDate?: string;
    intent?: string;
  },
): Promise<{
  id: string;
  monthlyRequired: number;
  monthlyCapacity: number;
  feasibility: "comfortable" | "tight" | "impossible" | "unknown";
}> {
  if (!input.name.trim()) throw new Error("Give your goal a name.");
  if (input.targetAmount <= 0) throw new Error("Set a target above zero.");

  // Default to the profile's first account: a goal is a pot of money, so it has
  // to live somewhere, and demanding one up front is a pointless extra step for
  // a user who has only ever had one account.
  const [account] = await db.query<{ id: string }>(
    `SELECT id FROM accounts
      WHERE profile_id = ? AND deleted_at IS NULL AND is_archived = 0
        ${input.accountId ? "AND id = ?" : ""}
      ORDER BY created_at ASC`,
    input.accountId ? [profileId, input.accountId] : [profileId],
  );
  const accountId = input.accountId ?? account?.id;
  if (!accountId) throw new Error("Add an account before creating a goal.");
  if (input.accountId && !account) throw new Error("That account is not available.");

  const timestamp = new Date().toISOString();
  const targetDate = input.targetDate || null;
  const months = targetDate
    ? Math.max(
        1,
        (new Date(`${targetDate}T00:00:00Z`).getUTCFullYear() - new Date().getUTCFullYear()) * 12 +
          new Date(`${targetDate}T00:00:00Z`).getUTCMonth() -
          new Date().getUTCMonth(),
      )
    : 0;
  const monthlyRequired = months ? Math.ceil(input.targetAmount / months) : 0;
  const [monthly] = await db.query<{ income: number | null; expenses: number | null }>(
    `SELECT
       SUM(CASE WHEN t.type = 'inflow' THEN t.amount ELSE 0 END) AS income,
       SUM(CASE WHEN t.type = 'outflow' THEN t.amount ELSE 0 END) AS expenses
       FROM transactions t
       JOIN accounts a ON a.id = t.account_id
      WHERE a.profile_id = ? AND t.deleted_at IS NULL
        AND t.occurred_on >= date('now', '-90 day')`,
    [profileId],
  );
  const monthlyCapacity = Math.max(0, ((monthly?.income ?? 0) - (monthly?.expenses ?? 0)) / 3);
  const feasibility =
    !monthlyRequired ? "unknown" : monthlyRequired <= monthlyCapacity * 0.8 ? "comfortable" : monthlyRequired <= monthlyCapacity ? "tight" : "impossible";
  const goalId = crypto.randomUUID();
  const goal = {
    id: goalId,
    profile_id: profileId,
    account_id: accountId,
    name: input.name.trim(),
    target_amount: input.targetAmount,
    current_amount: 0,
    status: "active",
    target_date: targetDate,
    monthly_required: monthlyRequired,
    feasibility,
    intent: input.intent?.trim() || null,
    created_at: timestamp,
    updated_at: timestamp,
    deleted_at: null,
    origin: "local",
  };
  await db.batch([
    {
      sql: `INSERT INTO financial_goals
              (id, profile_id, account_id, name, target_amount, current_amount, status,
               target_date, monthly_required, feasibility, intent,
               created_at, updated_at, origin)
            VALUES (?, ?, ?, ?, ?, 0, 'active', ?, ?, ?, ?, ?, ?, 'local')`,
      bind: [
        goalId,
        profileId,
        accountId,
        input.name.trim(),
        input.targetAmount,
        targetDate,
        monthlyRequired,
        feasibility,
        input.intent?.trim() || null,
        timestamp,
        timestamp,
      ],
    },
    ...(monthlyRequired > 0
      ? [{
          sql: `INSERT INTO goal_recommendations
                  (id, goal_id, title, description, created_at, updated_at, origin)
                VALUES (?, ?, ?, ?, ?, ?, 'local')`,
          bind: [
            crypto.randomUUID(),
            goalId,
            feasibility === "impossible" ? "This date needs a different plan" : "Your starting point",
            feasibility === "impossible"
              ? `You would need ${monthlyRequired} per month, but your recent average leaves about ${Math.round(monthlyCapacity)} available. Consider a later date, a smaller target, or reducing expenses.`
              : `Set aside ${monthlyRequired} per month to reach this target by ${targetDate}.`,
            timestamp,
            timestamp,
          ],
        }]
      : []),
    outbox("financial_goals", goalId, goal),
  ]);
  return { id: goalId, monthlyRequired, monthlyCapacity, feasibility };
}

export async function addGoalRecommendation(
  db: LocalDb,
  profileId: string,
  goalId: string,
  title: string,
  description: string,
): Promise<void> {
  const [goal] = await db.query<FinancialGoal>(
    "SELECT * FROM financial_goals WHERE id = ? AND profile_id = ? AND deleted_at IS NULL",
    [goalId, profileId],
  );
  if (!goal) throw new Error("That plan no longer exists.");
  const timestamp = new Date().toISOString();
  const recommendation = {
    id: crypto.randomUUID(),
    profile_id: profileId,
    goal_id: goalId,
    title: title.trim(),
    description: description.trim(),
    created_at: timestamp,
    updated_at: timestamp,
    deleted_at: null,
    origin: "ai",
  };
  await db.batch([{
    sql: `INSERT INTO goal_recommendations
            (id, goal_id, title, description, created_at, updated_at, origin)
          VALUES (?, ?, ?, ?, ?, ?, 'ai')`,
    bind: [recommendation.id, goalId, recommendation.title, recommendation.description, timestamp, timestamp],
  }, outbox("goal_recommendations", recommendation.id, recommendation)]);
}

/** Adds to (or subtracts from) a goal's saved amount. */
export async function contributeToGoal(
  db: LocalDb,
  profileId: string,
  goalId: string,
  amount: number,
): Promise<void> {
  if (amount === 0) return;

  const [goal] = await db.query<FinancialGoal>(
    "SELECT * FROM financial_goals WHERE id = ? AND profile_id = ? AND deleted_at IS NULL",
    [goalId, profileId],
  );
  if (!goal) throw new Error("That goal no longer exists.");

  const updatedAt = new Date().toISOString();
  const updated = {
    ...goal,
    current_amount: Math.max(0, goal.current_amount + amount),
    updated_at: updatedAt,
  };
  await db.batch([
    {
      // Clamped at zero by the app layer, and guarded here so a negative
      // "saved" figure can never reach a progress bar.
      sql: `UPDATE financial_goals
               SET current_amount = MAX(0, current_amount + ?), updated_at = ?
             WHERE id = ?`,
      bind: [amount, updatedAt, goalId],
    },
    outbox("financial_goals", goalId, updated),
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
  return { listGoals, createGoal, contributeToGoal, addGoalRecommendation };
}