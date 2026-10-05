"use client";

import { useEffect, useState } from "react";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import {
  createBudget,
  currentBudget,
  formatMoney,
  setBudgetLimit,
  today,
  type BudgetWithProgress,
} from "@/lib/local-db";
import { useLocalDb } from "@/lib/local-db/provider";
import { useAutoRefresh, useVault } from "@/lib/local-db/vault";

import { useCategories } from "@/hooks/use-categories";

const FIELD_CLASS =
  "h-11 w-28 shrink-0 rounded-2xl border border-input bg-transparent px-3 text-right text-sm tabular-nums outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40";

/**
 * Budgets: the current period's progress, plus every limit on offer.
 *
 * Over-budget lines are stated as a fact ("R240 over") rather than a verdict,
 * per the spec's "don't shame the user" rule — the number is the message.
 */
export default function BudgetsPage() {
  const { db } = useLocalDb();
  const { activeProfile } = useVault();
  const expenseCategories = useCategories("expense");

  const currency = activeProfile?.currency ?? "USD";
  const [budget, setBudget] = useState<BudgetWithProgress | null>(null);
  const [limits, setLimits] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useAutoRefresh(activeProfile?.id);

  useEffect(() => {
    if (!db || !activeProfile) return;
    let cancelled = false;

    void currentBudget(db, activeProfile.id, today())
      .then((result) => {
        if (cancelled) return;
        setBudget(result);
        // Prefill from the existing budget so this screen edits rather than
        // re-creates — typing over the current limits is the common case.
        if (result) {
          setLimits(
            Object.fromEntries(
              result.lines.map((line) => [
                line.item.category_id,
                (line.item.limit_amount / 100).toFixed(2),
              ]),
            ),
          );
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "Couldn't load budgets.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [db, activeProfile]);

  async function save() {
    if (!db || !activeProfile) return;

    const items = Object.entries(limits)
      .map(([categoryId, raw]) => ({ categoryId, raw: raw.trim() }))
      .filter((entry) => entry.raw !== "")
      .map((entry) => ({
        categoryId: entry.categoryId,
        limitAmount: Math.round(Number(entry.raw.replace(",", ".")) * 100),
      }))
      .filter((item) => Number.isFinite(item.limitAmount) && item.limitAmount >= 0);

    if (items.length === 0) {
      setError("Set a limit on at least one category.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      if (budget) {
        // Edit in place so the period and its history are preserved. One
        // upsert per line, rather than recreate — the budget row is what ties
        // these limits to a specific month.
        for (const item of items) {
          await setBudgetLimit(
            db,
            activeProfile.id,
            budget.budget.id,
            item.categoryId,
            item.limitAmount,
          );
        }
      } else {
        await createBudget(db, activeProfile.id, {
          period: "monthly",
          startsOn: `${today().slice(0, 7)}-01`,
          items,
        });
      }
      setBudget(await currentBudget(db, activeProfile.id, today()));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't save your budget.");
    } finally {
      setSaving(false);
    }
  }

// A budget of nothing with nothing spent is "on track", not "infinite left".
  const remaining = budget ? budget.budgeted - budget.spent : 0;

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-8">
      <header>
        <Link
          href="/dashboard"
          className="mb-3 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Home
        </Link>

        <h1 className="text-2xl font-semibold tracking-tight">Budgets</h1>
        <p className="text-sm text-muted-foreground">
          A limit per category, for this month.
        </p>
      </header>

      {budget && (
        <section
          aria-label="Budget summary"
          className="rounded-3xl bg-card p-5 shadow-soft ring-1 ring-foreground/6"
        >
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm text-muted-foreground">Left to spend</span>
            <span
              className={`text-xl font-semibold tabular-nums ${
                remaining < 0 ? "text-expense-strong" : "text-income-strong"
              }`}
            >
              {formatMoney(remaining, currency)}
            </span>
          </div>
          <p className="mt-1 text-xs tabular-nums text-muted-foreground">
            {formatMoney(budget.spent, currency)} spent of{" "}
            {formatMoney(budget.budgeted, currency)}
          </p>
        </section>
      )}

      {expenseCategories.length === 0 ? (
        <p className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
          Add a few categories first and you can set limits on them here.
        </p>
      ) : (
        <section aria-label="Limits" className="space-y-3">
          <h2 className="text-sm font-medium">Limits</h2>

          <ul className="flex flex-col gap-2">
            {expenseCategories.map((category) => {
              const line = budget?.lines.find(
                (entry) => entry.item.category_id === category.id,
              );
              return (
                <li key={category.id} className="space-y-1.5">
                  <div className="flex items-center gap-3">
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {category.name}
                    </span>
                    <input
                      value={
                        limits[category.id] ??
                        (line ? (line.item.limit_amount / 100).toFixed(2) : "")
                      }
                      onChange={(event) =>
                        setLimits((current) => ({
                          ...current,
                          [category.id]: event.target.value,
                        }))
                      }
                      inputMode="decimal"
                      placeholder="—"
                      aria-label={`Monthly limit for ${category.name}`}
                      className={FIELD_CLASS}
                    />
                  </div>

                  {/* Progress appears only once a limit exists, so the row stays
                      quiet for categories the user hasn't chosen to cap. */}
                  {line && (
                    <p className="text-xs tabular-nums text-muted-foreground">
                      {line.state === "over"
                        ? `${formatMoney(Math.abs(line.remaining), currency)} over`
                        : `${formatMoney(line.remaining, currency)} left`}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>

          {error && (
            <p role="alert" className="text-sm text-expense-strong">
              {error}
            </p>
          )}

          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="h-12 w-full rounded-2xl bg-primary text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-50"
          >
            {saving ? "Saving…" : budget ? "Update my budget" : "Set my budget"}
          </button>
        </section>
      )}
    </div>
  );
}