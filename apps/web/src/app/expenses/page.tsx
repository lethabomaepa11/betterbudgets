"use client";

import { useEffect, useState } from "react";

import { ArrowLeft, Plus, TrendingDown } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import TransactionRow from "@/components/transaction-row";
import {
  currentMonth,
  formatMoney,
  formatMonthLabel,
  type Transaction,
} from "@/lib/local-db";
import { useLocalDb } from "@/lib/local-db/provider";
import { useAutoRefresh, useVault } from "@/lib/local-db/vault";

import { useAccounts } from "@/hooks/use-accounts";

/**
 * Everything that left this month, and everything that came in.
 *
 * Both directions share this screen because "what did I spend, and against what"
 * is a single question — splitting them across two routes means the user has to
 * remember which side of the ledger they were already looking at.
 */
export default function ExpensesPage() {
  const router = useRouter();
  const { ledger } = useLocalDb();
  const { activeProfile } = useVault();
  const accounts = useAccounts();

  const currency = activeProfile?.currency ?? "USD";
  const [month] = useState(currentMonth);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useAutoRefresh(`${activeProfile?.id}:${month}`);

  useEffect(() => {
    if (!ledger || !activeProfile) return;
    let cancelled = false;

    void (async () => {
      const [list, totals] = await Promise.all([
        ledger.listTransactionsByType(activeProfile.id, "outflow", month),
        ledger.monthlyTotalsByType(activeProfile.id, "outflow", month),
      ]);
      if (cancelled) return;
      setTransactions(list);
      setTotal(totals.outflow);
    })().catch((cause: unknown) => {
      if (!cancelled) {
        setError(cause instanceof Error ? cause.message : "Couldn't load expenses.");
      }
    });

    return () => {
      cancelled = true;
    };
  }, [ledger, activeProfile, month]);

  const nameOf = (accountId: string) =>
    accounts.find((row) => row.id === accountId)?.name ?? "Account";

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

        <h1 className="text-2xl font-semibold tracking-tight">Expenses</h1>
        <p className="text-sm text-muted-foreground">{formatMonthLabel(month)}</p>

        <p className="mt-3 text-3xl font-semibold tracking-tight text-expense-strong tabular-nums">
          {formatMoney(total, currency)}
        </p>
      </header>

      {error && (
        <p role="alert" className="text-sm text-expense-strong">
          {error}
        </p>
      )}

      {transactions.length === 0 ? (
        <div className="rounded-3xl border border-dashed p-8 text-center">
          <span className="mb-3 flex size-12 items-center justify-center rounded-2xl bg-primary-subtle text-primary">
            <TrendingDown className="size-5" aria-hidden="true" />
          </span>
          <p className="text-sm text-muted-foreground">
            Nothing spent in {formatMonthLabel(month)} yet.
          </p>
          <button
            type="button"
            onClick={() => router.push("/transactions/new")}
            className="mt-4 inline-flex h-11 items-center gap-1.5 rounded-full bg-primary px-5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover"
          >
            <Plus className="size-4" aria-hidden="true" />
            Add a transaction
          </button>
        </div>
      ) : (
        <>
          <button
            type="button"
            onClick={() => router.push("/transactions/new")}
            className="h-12 w-full rounded-2xl bg-primary text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover"
          >
            Add an expense
          </button>

          <ul className="flex flex-col gap-2">
            {transactions.map((transaction) => (
              <TransactionRow
                key={transaction.id}
                transaction={transaction}
                currency={currency}
                accountName={nameOf(transaction.account_id)}
              />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}