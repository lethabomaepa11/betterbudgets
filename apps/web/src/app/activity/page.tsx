"use client";

import { useEffect, useMemo, useState } from "react";

import { ArrowLeft, Bell } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import TransactionRow from "@/components/transaction-row";
import { formatMoney, type Transaction } from "@/lib/local-db";
import { useLocalDb } from "@/lib/local-db/provider";
import { useAutoRefresh, useVault } from "@/lib/local-db/vault";

import { useAccounts } from "@/hooks/use-accounts";

type Filter = "all" | "inflow" | "outflow";

const FILTERS: readonly { value: Filter; label: string }[] = [
  { value: "all", label: "Everything" },
  { value: "inflow", label: "Money in" },
  { value: "outflow", label: "Money out" },
];

/**
 * Everything that happened, newest first — the app's notifications surface.
 *
 * Since every entry is written locally and immediately, this is a record of what
 * you did rather than anything pushed from elsewhere, which is why it is a plain
 * filtered list instead of a permission-gated push channel.
 */
export default function ActivityPage() {
  const router = useRouter();
  const { ledger } = useLocalDb();
  const { activeProfile } = useVault();
  const accounts = useAccounts();

  const currency = activeProfile?.currency ?? "USD";
  const [filter, setFilter] = useState<Filter>("all");
  const [rows, setRows] = useState<Transaction[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Re-reads after any write, so a transaction added from the centre button shows
  // up here without a manual refresh.
  const refreshVersion = useAutoRefresh(`${activeProfile?.id}:${filter}`);

  useEffect(() => {
    if (!ledger || !activeProfile) return;
    let cancelled = false;

    void ledger
      .listActivity(activeProfile.id, {
        type: filter === "all" ? undefined : filter,
        limit: 100,
      })
      .then((list) => {
        if (!cancelled) setRows(list);
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "Couldn't load activity.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [ledger, activeProfile, filter, refreshVersion]);

  const nameOf = useMemo(() => {
    const map = new Map(accounts.map((row) => [row.id, row.name]));
    return (accountId: string) => map.get(accountId) ?? "Account";
  }, [accounts]);

  return (
    <div className="flex flex-col gap-6">
      <header>
        <Link
          href="/dashboard"
          className="mb-3 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Home
        </Link>

        <h1 className="text-2xl font-semibold tracking-tight">Activity</h1>
        <p className="text-sm text-muted-foreground">Everything you've logged.</p>
      </header>

      {/* Two tabs rather than a select: with three options and no need to combine
          them with anything else, tabs stay legible where a select hides state. */}
      <div role="tablist" aria-label="Filter activity" className="flex gap-2">
        {FILTERS.map((option) => (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={filter === option.value}
            onClick={() => setFilter(option.value)}
            className={`h-10 flex-1 rounded-full text-sm font-medium transition-colors ${
              filter === option.value
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

      {rows.length === 0 ? (
        <div className="rounded-3xl border border-dashed p-8 text-center">
          <span className="mb-3 flex size-12 items-center justify-center rounded-2xl bg-primary-subtle text-primary">
            <Bell className="size-5" aria-hidden="true" />
          </span>
          <p className="text-sm text-muted-foreground">
            Nothing logged yet. Anything you add shows up here.
          </p>
          <button
            type="button"
            onClick={() => router.push("/transactions/new")}
            className="mt-4 h-11 rounded-full bg-primary px-5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover"
          >
            Add your first transaction
          </button>
        </div>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            {rows.length} transaction{rows.length === 1 ? "" : "s"}
          </p>

          <ul className="flex flex-col gap-2">
            {rows.map((transaction) => (
              <TransactionRow
                key={transaction.id}
                transaction={transaction}
                currency={currency}
                accountName={nameOf(transaction.account_id)}
              />
            ))}
          </ul>

          <p className="pt-2 text-xs text-muted-foreground">
            Totals this month:{" "}
            {formatMoney(
              rows.reduce((sum, row) => sum + (row.type === "inflow" ? row.amount : -row.amount),
                0,
              ),
              currency,
            )}{" "}
            net across the accounts shown.
          </p>
        </>
      )}
    </div>
  );
}