"use client";

import type { Route } from "next";
import { Plus } from "lucide-react";
import Link from "next/link";

import { formatMoney, type AccountType } from "@/lib/local-db";
import { useVault } from "@/lib/local-db/vault";

import { useAccounts } from "@/hooks/use-accounts";

/** Human labels. Typed as a total `Record` so adding an AccountType to the model
 *  is a compile error here rather than an empty chip at runtime. */
const TYPE_LABEL: Record<AccountType, string> = {
  checking: "Bank account",
  savings: "Savings",
  credit: "Credit card",
  cash: "Cash",
  investment: "Investment",
  other: "Other",
};

export default function AccountsPage() {
  const accounts = useAccounts();
  const { activeProfile } = useVault();
  const currency = activeProfile?.currency ?? "USD";

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Accounts</h1>
          <p className="text-sm text-muted-foreground">
            Where your money is, and what each one has done.
          </p>
        </div>

        <Link
          href="/accounts/new"
          className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover"
        >
          <Plus className="size-4" aria-hidden="true" />
          Add
        </Link>
      </header>

      {accounts.length === 0 ? (
        <div className="rounded-3xl border border-dashed p-8 text-center">
          <p className="text-sm text-muted-foreground">
            No accounts yet. Add one — every transaction belongs to an account.
          </p>
          <Link
            href="/accounts/new"
            className="mt-4 inline-flex h-11 items-center rounded-full bg-primary px-5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover"
          >
            Add your first account
          </Link>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {accounts.map((account) => (
            <li key={account.id}>
              <Link
                href={`/accounts/${account.id}` as Route}
                className="block rounded-2xl bg-card p-4 shadow-soft ring-1 ring-foreground/6 transition-colors hover:bg-accent/50"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate text-sm font-medium">{account.name}</span>
                  <span
                    className={`text-sm font-semibold tabular-nums ${
                      account.net < 0 ? "text-expense-strong" : ""
                    }`}
                  >
                    {formatMoney(account.net, currency)}
                  </span>
                </div>

                <p className="mt-1 text-xs text-muted-foreground">
                  {TYPE_LABEL[account.type]}
                  {/* Both totals are shown so a large balance with little recent
                      activity is visibly different from a balance being worked
                      through. */}
                  {account.inflow > 0 && ` · in ${formatMoney(account.inflow, currency)}`}
                  {account.outflow > 0 && ` · out ${formatMoney(account.outflow, currency)}`}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}