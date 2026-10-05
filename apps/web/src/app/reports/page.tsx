"use client";

import { useEffect, useState } from "react";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import {
  createReports,
  currentMonth,
  formatMoney,
  formatMonthLabel,
} from "@/lib/local-db";
import { useLocalDb } from "@/lib/local-db/provider";
import { useAutoRefresh, useVault } from "@/lib/local-db/vault";

type Range = "month" | "3m" | "6m" | "12m";

const RANGES: readonly { value: Range; label: string; months: number }[] = [
  { value: "month", label: "This month", months: 1 },
  { value: "3m", label: "3 months", months: 3 },
  { value: "6m", label: "6 months", months: 6 },
  { value: "12m", label: "12 months", months: 12 },
];

type CategoryRow = { categoryId: string | null; name: string; total: number; count: number };
type TrendRow = { month: string; inflow: number; outflow: number; net: number };

/**
 * Spending, income and cash flow.
 *
 * Reports are read-only by design. Anything a report does that the dashboard
 * doesn't — rounding a percentage differently, dropping uncategorised spend —
 * makes the two disagree, and a user who spots that stops trusting both.
 */
export default function ReportsPage() {
  const { db } = useLocalDb();
  const { activeProfile } = useVault();

  const currency = activeProfile?.currency ?? "USD";
  const [range, setRange] = useState<Range>("month");
  const [byCategory, setByCategory] = useState<CategoryRow[]>([]);
  const [trend, setTrend] = useState<TrendRow[]>([]);
  const [balance, setBalance] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useAutoRefresh(`${activeProfile?.id}:${range}`);

  useEffect(() => {
    if (!db || !activeProfile) return;
    let cancelled = false;

    const months = RANGES.find((option) => option.value === range)?.months ?? 1;
    // The window ends at "tomorrow" so a transaction logged for today is inside
    // it — otherwise the report is always a day behind the rest of the app.
    const before = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const from = months === 1 ? `${currentMonth()}-01` : monthsAgoStart(months);

    void (async () => {
      // Called as module functions with `db` passed explicitly: `createReports`
      // exposes them rather than binding them, so there is no hidden `this`.
      const { spendingByCategory, monthlyTrend, totalBalance } = createReports(db);
      const [categories, series, total] = await Promise.all([
        spendingByCategory(db, activeProfile.id, from, before),
        monthlyTrend(db, activeProfile.id, months),
        totalBalance(db, activeProfile.id),
      ]);
      if (cancelled) return;
      setByCategory(categories);
      setTrend(series);
      setBalance(total);
    })().catch((cause: unknown) => {
      if (!cancelled) {
        setError(cause instanceof Error ? cause.message : "Couldn't load reports.");
      }
    });

    return () => {
      cancelled = true;
    };
  }, [db, activeProfile, range]);

  const spent = byCategory.reduce((sum, row) => sum + row.total, 0);
  const current = trend[trend.length - 1];
  const peak = Math.max(1, ...trend.map((row) => Math.max(row.inflow, row.outflow)));

  return (
    <div className="flex flex-col gap-8">
      <header>
        <Link
          href="/dashboard"
          className="mb-3 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Home
        </Link>

        <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
        <p className="text-sm text-muted-foreground">
          Where your money went, and whether that is changing.
        </p>
      </header>

      <div role="tablist" aria-label="Reporting range" className="flex flex-wrap gap-2">
        {RANGES.map((option) => (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={range === option.value}
            onClick={() => setRange(option.value)}
            className={`h-9 rounded-full px-3.5 text-sm font-medium transition-colors ${
              range === option.value
                ? "bg-primary-subtle text-primary"
                : "bg-muted text-muted-foreground hover:text-foreground"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {error && (
        <p role="alert" className="text-sm text-expense-strong">
          {error}
        </p>
      )}

      <section aria-label="Totals" className="grid gap-4 sm:grid-cols-3">
        <Tile label="Total balance" value={formatMoney(balance, currency)} />
        <Tile
          label="Money in"
          value={formatMoney(current?.inflow ?? 0, currency)}
          tone="text-income-strong"
        />
        <Tile
          label="Spent"
          value={formatMoney(spent, currency)}
          tone="text-expense-strong"
        />
      </section>

      <section aria-label="Spending by category">
        <h2 className="mb-3 text-base font-medium">Spending by category</h2>

        {byCategory.length === 0 ? (
          <p className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            Nothing spent in this period yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {byCategory.map((row) => {
              const share = spent === 0 ? 0 : row.total / spent;
              return (
                <li key={row.categoryId ?? "uncategorised"}>
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="truncate">
                      {row.name}
                      <span className="ml-1.5 text-xs text-muted-foreground">
                        {row.count}×
                      </span>
                    </span>
                    <span className="shrink-0 tabular-nums">
                      {formatMoney(row.total, currency)}
                    </span>
                  </div>

                  {/* Width carries the share; the percentage is stated in text
                      below, so the bar never has to carry the number. */}
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-expense/70"
                      style={{ width: `${Math.max(share * 100, 2)}%` }}
                    />
                  </div>
                  <p className="mt-1 text-xs tabular-nums text-muted-foreground">
                    {Math.round(share * 100)}% of spending
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </section>
<section aria-label="Income versus spending">
        <h2 className="mb-3 text-base font-medium">Income vs spending</h2>

        <ul className="flex flex-col gap-2">
          {trend.map((row) => (
            <li
              key={row.month}
              className="rounded-2xl bg-card p-3 ring-1 ring-foreground/6"
            >
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span>{formatMonthLabel(row.month)}</span>
                <span
                  className={`tabular-nums ${
                    row.net < 0 ? "text-expense-strong" : "text-income-strong"
                  }`}
                >
                  {row.net < 0 ? "−" : "+"}
                  {formatMoney(Math.abs(row.net), currency)}
                </span>
              </div>

              {/* Paired bars on one baseline: the comparison is the point, and
                  two separate charts make the reader do the arithmetic. */}
              <div className="mt-2 flex gap-4">
                <div className="flex-1">
                  <div
                    className="h-2 rounded-full bg-income/60"
                    style={{ width: `${(row.inflow / peak) * 100}%` }}
                  />
                  <p className="mt-1 text-[11px] tabular-nums text-muted-foreground">
                    in {formatMoney(row.inflow, currency)}
                  </p>
                </div>
                <div className="flex-1">
                  <div
                    className="h-2 rounded-full bg-expense/60"
                    style={{ width: `${(row.outflow / peak) * 100}%` }}
                  />
                  <p className="mt-1 text-[11px] tabular-nums text-muted-foreground">
                    out {formatMoney(row.outflow, currency)}
                  </p>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Tile({
  label,
  value,
  tone = "text-foreground",
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="rounded-2xl bg-card p-4 shadow-soft ring-1 ring-foreground/6">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 text-xl font-semibold tabular-nums ${tone}`}>{value}</p>
    </div>
  );
}

/** First day of the month, `months` back. */
function monthsAgoStart(months: number): string {
  const cursor = new Date();
  cursor.setMonth(cursor.getMonth() - (months - 1));
  return `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-01`;
}