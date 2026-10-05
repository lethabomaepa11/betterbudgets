"use client";

import { useEffect, useState } from "react";

import type { Route } from "next";
import { ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";

import {
  createBudget,
  moneyToInput,
  parseMoney,
  type BudgetPeriod,
  type LocalDbHandle,
} from "@/lib/local-db";
import { useLocalDb } from "@/lib/local-db/provider";
import { STEP_COPY } from "@/lib/onboarding-steps";
import { today } from "@/lib/local-db";
import { useVault } from "@/lib/local-db/vault";

import { useCategories } from "@/hooks/use-categories";

const FIELD_CLASS =
  "h-11 w-full min-w-0 rounded-2xl border border-input bg-transparent px-3.5 text-sm tabular-nums outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40";

/**
 * Step 5 — the first budget.
 *
 * Only expense categories are offered. A limit on money coming *in* is not a
 * budget, and showing an income category here would imply something the app
 * doesn't actually compute.
 *
 * Limits are typed into empty boxes rather than pre-filled with guesses: a
 * fabricated number is worse than none, because the user has to notice and
 * correct a lie before trusting the figure.
 */
export default function OnboardingBudgetPage() {
  const router = useRouter();
  const { db } = useLocalDb();
  const { activeProfile, setOnboardingStep, busy } = useVault();
  const categories = useCategories("expense");

  const [period, setPeriod] = useState<BudgetPeriod>("monthly");
  const [limits, setLimits] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setLimit(id: string, value: string) {
    setLimits((current) => ({ ...current, [id]: value }));
  }

  async function save() {
    if (!db || !activeProfile) return;

    const items: { categoryId: string; limitAmount: number }[] = [];
    for (const [categoryId, raw] of Object.entries(limits)) {
      if (!raw.trim()) continue;
      const minor = parseMoney(raw);
      if (minor === null || minor < 0) {
        setError("One of those limits isn't a number.");
        return;
      }
      if (minor > 0) items.push({ categoryId, limitAmount: minor });
    }

    if (items.length === 0) {
      setError("Set at least one limit, or skip this step.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await createBudget(db, activeProfile.id, {
        period,
        // A monthly budget starts on the 1st; a weekly one on today, because
        // "this week" is the only framing that means anything to someone
        // budgeting the week they're in.
        startsOn: period === "monthly" ? `${today().slice(0, 7)}-01` : today(),
        items,
      });
      await setOnboardingStep("done");
      router.push("/dashboard" as Route);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't save that budget.");
      setSaving(false);
    }
  }

  async function skip() {
    setSaving(true);
    await setOnboardingStep("done");
    router.push("/dashboard" as Route);
  }

  const periodLabel: Record<BudgetPeriod, string> = {
    monthly: "Every month",
    weekly: "Every week",
  };

  return (
    <div className="flex flex-col gap-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">{STEP_COPY.budget.title}</h1>
        <p className="text-sm/relaxed text-muted-foreground">{STEP_COPY.budget.body}</p>
      </header>

      <fieldset>
        <legend className="text-sm font-medium">How often</legend>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {(["monthly", "weekly"] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={period === option}
              onClick={() => setPeriod(option)}
              className={`h-12 rounded-2xl border text-sm font-medium transition-colors ${
                period === option
                  ? "border-primary bg-primary-subtle text-primary"
                  : "border-input hover:bg-accent/50"
              }`}
            >
              {periodLabel[option]}
            </button>
          ))}
        </div>
      </fieldset>

      {categories.length === 0 ? (
        <p className="rounded-2xl border border-dashed p-5 text-sm text-muted-foreground">
          Add a few categories first and you can set limits on them here. You can
          also skip this and add limits later.
        </p>
      ) : (
        <section className="space-y-2">
          <h2 className="text-sm font-medium">Limits</h2>
          <p className="text-xs text-muted-foreground">
            Leave anything blank to skip it.
          </p>

          <ul className="flex flex-col gap-1.5">
            {categories.map((category) => (
              <li key={category.id} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-sm">
                  {category.name}
                </span>
                <input
                  value={limits[category.id] ?? ""}
                  onChange={(event) => setLimit(category.id, event.target.value)}
                  inputMode="decimal"
                  placeholder="—"
                  aria-label={`${periodLabel[period]} limit for ${category.name}`}
                  className={`${FIELD_CLASS} w-28 text-right`}
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      {error && (
        <p role="alert" className="text-sm text-expense-strong">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={() => void save()}
        disabled={saving || busy || categories.length === 0}
        className="h-14 w-full rounded-2xl bg-primary text-base font-medium text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-50"
      >
        {saving ? "Saving…" : "Start budgeting"}
      </button>

      <button
        type="button"
        onClick={() => void skip()}
        disabled={saving || busy}
        className="-mt-4 h-11 w-full text-sm text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
      >
        Skip for now
      </button>
    </div>
  );
}