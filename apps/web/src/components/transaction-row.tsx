"use client";

import type { Transaction, TransactionType } from "@/lib/local-db";
import { formatDay, formatMoney } from "@/lib/local-db";

/**
 * One row in a transaction list, used by the activity, income, expenses and
 * account screens so a transaction looks and behaves identically everywhere.
 *
 * Edit and delete are rendered by the caller rather than handled here: the
 * screens differ in what they do afterwards (a dialog, a page, a back
 * navigation), and burying that decision in this component is how one screen
 * ends up deleting something another screen still shows.
 */
export default function TransactionRow({
  transaction,
  currency,
  accountName,
  actions,
}: {
  transaction: Transaction;
  currency: string;
  /** Shown when the list spans several accounts. */
  accountName?: string;
  actions?: React.ReactNode;
}) {
  const income = transaction.type === "inflow";

  return (
    <li className="flex items-center gap-3 rounded-2xl bg-card p-4 shadow-soft ring-1 ring-foreground/6">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {transaction.name ?? (income ? "Money in" : "Money out")}
        </p>
        <p className="text-xs text-muted-foreground">
          {/* Generated occurrences are marked, so a user looking at rent can see
              why another one is already sitting there. */}
          {formatDay(transaction.occurred_on)}
          {transaction.recurring_id ? " · recurring" : ""}
          {accountName ? ` · ${accountName}` : ""}
        </p>
      </div>

      <span
        className={`shrink-0 text-sm font-semibold tabular-nums ${
          income ? "text-income-strong" : "text-expense-strong"
        }`}
      >
        {income ? "+" : "−"}
        {formatMoney(transaction.amount, currency)}
      </span>

      {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
    </li>
  );
}

export type { TransactionType };