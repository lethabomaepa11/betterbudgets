"use client";

import { useEffect, useState } from "react";

import {
  contributeToGoal,
  createGoals,
  formatMoney,
  parseMoney,
  type FinancialGoal,
} from "@/lib/local-db";
import { useLocalDb } from "@/lib/local-db/provider";
import { useAutoRefresh, useVault } from "@/lib/local-db/vault";

import { useAccounts } from "@/hooks/use-accounts";

type GoalRow = FinancialGoal & { accountName: string };

const FIELD_CLASS =
  "h-12 w-full rounded-2xl border border-input bg-transparent px-4 outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40";

/**
 * Savings goals, and how far each one has come.
 *
 * Progress is capped at 100% — a goal past its target is finished, and a bar
 * that kept growing past the edge would read as a rendering bug rather than good
 * news.
 */
export default function GoalsPage() {
  const { db } = useLocalDb();
  const { activeProfile, dataChanged } = useVault();
  const accounts = useAccounts();

  const currency = activeProfile?.currency ?? "USD";
  const [goals, setGoals] = useState<GoalRow[]>([]);
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [accountId, setAccountId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-reads on mount and after every write, so a goal added here appears without
  // a manual refresh. `dataChanged` in the dependency list is what re-runs this.
  useAutoRefresh(`${activeProfile?.id}:goals`);

  useEffect(() => {
    if (!db || !activeProfile) return;
    let cancelled = false;

    void createGoals(db)
      .listGoals(db, activeProfile.id)
      .then((rows) => {
        if (!cancelled) setGoals(rows);
      })
      .catch(() => {
        /* The empty state covers a failed read. */
      });

    return () => {
      cancelled = true;
    };
  }, [db, activeProfile, dataChanged]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!db || !activeProfile) return;

    const targetMinor = parseMoney(target);
    if (targetMinor === null || targetMinor <= 0) {
      setError("Set a target above zero.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await createGoals(db).createGoal(db, activeProfile.id, {
        name: name.trim(),
        targetAmount: targetMinor,
        accountId: accountId || undefined,
      });
      setName("");
      setTarget("");
      dataChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't save that goal.");
    } finally {
      setSaving(false);
    }
return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Goals</h1>
        <p className="text-sm text-muted-foreground">
          What you&apos;re saving towards.
        </p>
      </header>

      {goals.length === 0 ? (
        <p className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
          No goals yet. An emergency fund or a holiday are good first ones.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {goals.map((goal) => {
            const progress =
              goal.target_amount === 0
                ? 0
                : Math.min(1, goal.current_amount / goal.target_amount);
            const done = progress >= 1;

            return (
              <li
                key={goal.id}
                className="rounded-2xl bg-card p-4 shadow-soft ring-1 ring-foreground/6"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate text-sm font-medium">{goal.name}</span>
                  <span className="shrink-0 text-sm tabular-nums">
                    {formatMoney(goal.current_amount, currency)}
                  </span>
                </div>

                <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-full rounded-full ${done ? "bg-income" : "bg-primary"}`}
                    style={{ width: `${Math.max(progress * 100, 2)}%` }}
                  />
                </div>

                <p className="mt-1.5 text-xs tabular-nums text-muted-foreground">
                  {done
                    ? `Reached · target was ${formatMoney(goal.target_amount, currency)}`
                    : `${Math.round(progress * 100)}% · ${formatMoney(goal.target_amount - goal.current_amount, currency)} to go`}
                </p>
                <p className="text-xs text-muted-foreground">{goal.accountName}</p>
              </li>
            );
          })}
        </ul>
      )}

      <form onSubmit={submit} className="space-y-4">
        <h2 className="text-sm font-medium">New goal</h2>

        <label className="block">
          <span className="text-sm font-medium">What for?</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Emergency fund"
            className={FIELD_CLASS}
          />
        </label>

        <label className="block">
          <span className="text-sm font-medium">Target</span>
          <input
            value={target}
            onChange={(event) => setTarget(event.target.value)}
            inputMode="decimal"
            placeholder="30,000"
            className={FIELD_CLASS}
          />
        </label>

        {/* Hidden for a single account: the goal defaults to it, so offering the
            choice would be one more decision with only one possible answer. */}
        {accounts.length > 1 && (
          <label className="block">
            <span className="text-sm font-medium">Keep it in</span>
            <select
              value={accountId}
              onChange={(event) => setAccountId(event.target.value)}
              className={FIELD_CLASS}
            >
              <option value="">My first account</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
          </label>
        )}

        {error && (
          <p role="alert" className="text-sm text-expense-strong">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={saving || accounts.length === 0}
          className="h-12 w-full rounded-2xl bg-primary text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-50"
        >
          {saving ? "Saving…" : "Add a goal"}
        </button>
      </form>
    </div>
  );
}
  }