"use client";

import { useEffect, useState } from "react";

import type { Route } from "next";

import { cn } from "@betterbudgets/ui/lib/utils";
import { Banknote, CreditCard, Landmark, PiggyBank, Repeat, TrendingUp, Wallet } from "lucide-react";
import Link from "next/link";

import LocalDbStatus from "@/components/local-db-status";
import NeedsYou from "@/components/needs-you";
import { useOccurrences } from "@/hooks/use-occurrences";
import { useLocalDb } from "@/lib/local-db/provider";
import {
  currentMonth,
  formatMoney,
  formatMonthLabel,
  type AccountWithTotals,
  type AccountType,
  type MonthlyTotals,
} from "@/lib/local-db";
import { useAutoRefresh, useVault } from "@/lib/local-db/vault";

/**
 * One icon per account type, so a credit card is distinguishable from a bank
 * account at a glance.
 */
const ACCOUNT_ICON: Record<AccountType, typeof Wallet> = {
  checking: Landmark,
  savings: PiggyBank,
  credit: CreditCard,
  cash: Banknote,
  investment: TrendingUp,
  other: Wallet,
};

/** Human labels. `Record` (not a lookup with a fallback) so a new AccountType
 *  cannot be added to the model without every screen being taught the word. */
const ACCOUNT_LABEL: Record<AccountType, string> = {
  checking: "Bank account",
  savings: "Savings",
  credit: "Credit card",
  cash: "Cash",
  investment: "Investment",
  other: "Other",
};

export default function Dashboard() {
  const { activeProfile } = useVault();
  const { ledger } = useLocalDb();

  // Re-reads whenever a write lands anywhere in the tree, which is what keeps
  // these totals honest after the transaction form saves.
  useAutoRefresh(activeProfile?.id);

  const currency = activeProfile?.currency ?? "USD";
  const [month] = useState(currentMonth);
  const [totals, setTotals] = useState<MonthlyTotals>({ inflow: 0, outflow: 0 });
  const [accounts, setAccounts] = useState<AccountWithTotals[]>([]);
  const { rows: occurrences } = useOccurrences();

  useEffect(() => {
    if (!ledger || !activeProfile) return;
    let cancelled = false;

    void (async () => {
      const [summary, rows] = await Promise.all([
        ledger.monthlyTotals(activeProfile.id, month),
        ledger.listAccountsWithTotals(activeProfile.id),
      ]);
      if (cancelled) return;
      setTotals(summary);
      setAccounts(rows);
    })().catch(() => {
      /* A failed read must not crash the page; the empty state below covers it. */
    });

    return () => {
      cancelled = true;
    };
  }, [ledger, activeProfile, month]);

  const firstName = activeProfile?.name.split(" ")[0];
  const remaining = totals.inflow - totals.outflow;

  // What is actually available to spend right now, across every account. The
  // "Left this month" figure below is a different thing: it measures the month,
  // not today's position, and using it to judge whether a bill is covered would
  // be wrong whenever money is left in a savings account.
  const availableBalance = accounts.reduce((total, account) => total + account.net, 0);

  // The two headline figures double as links into the screens that break them
  // down — the totals are the natural entry point, so leaving them inert would
  // waste the most-clicked thing on the page.
  const summary = [
    {
      label: "Income",
      value: formatMoney(totals.inflow, currency),
      tone: "text-income-strong",
      href: "/income",
    },
    {
      label: "Expenses",
      value: formatMoney(totals.outflow, currency),
      tone: "text-expense-strong",
      href: "/expenses",
    },
    {
      label: "Left this month",
      value: formatMoney(remaining, currency),
      tone: remaining < 0 ? "text-expense-strong" : "text-foreground",
      href: null,
    },
  ] satisfies readonly { label: string; value: string; tone: string; href: Route | null }[];

  return (
    <div className="flex flex-col gap-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          {firstName ? `Hey ${firstName}` : "Your budget"}
        </h1>
        <p className="text-muted-foreground">
          {formatMonthLabel(month)}, across every account on this device.
        </p>
      </header>

      {/* Above the totals on purpose: this is the only part of the dashboard
          that needs something from the user, and a summary of past months is a
          poor thing to put in front of it. */}
      <NeedsYou
        rows={occurrences}
        balance={availableBalance}
        currency={currency}
      />

      <section
        aria-label={`Summary for ${formatMonthLabel(month)}`}
        className="grid gap-4 sm:grid-cols-3"
      >
        {summary.map(({ label, value, tone, href }) => {
          const body = (
            <>
              <p className="text-sm text-muted-foreground">{label}</p>
              <p className={cn("mt-2 text-2xl font-semibold tracking-tight tabular-nums", tone)}>
                {value}
              </p>
            </>
          );

          return href ? (
            <Link
              key={label}
              href={href}
              className="rounded-2xl bg-card p-5 shadow-card ring-1 ring-foreground/6 transition-colors hover:bg-accent/50"
            >
              {body}
            </Link>
          ) : (
            <div
              key={label}
              className="rounded-2xl bg-card p-5 shadow-card ring-1 ring-foreground/6"
            >
              {body}
            </div>
          );
        })}
      </section>

      <section aria-label="Accounts">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-base font-medium">Accounts</h2>
          <Link
            href="/accounts"
            className="text-xs font-medium text-primary underline-offset-4 hover:underline"
          >
            See all
          </Link>
        </div>

        {accounts.length === 0 ? (
          <Link
            href="/accounts/new"
            className="flex items-center gap-3 rounded-2xl border border-dashed p-5 text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary-subtle text-primary">
              <Landmark className="size-4" aria-hidden="true" />
            </span>
            <span>
              <span className="block font-medium text-foreground">Add your first account</span>
              <span className="block text-xs">
                Transactions are recorded against an account, so start with one — your bank,
                wallet or savings.
              </span>
            </span>
          </Link>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {accounts.map((account) => {
              const Icon = ACCOUNT_ICON[account.type];
              return (
                <li key={account.id}>
                  <Link
                    href={`/accounts/${account.id}` as Route}
                    className="flex items-center justify-between gap-3 rounded-2xl bg-card p-4 shadow-soft ring-1 ring-foreground/6 transition-colors hover:bg-accent/50"
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary-subtle text-primary">
                        <Icon className="size-4" aria-hidden="true" />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{account.name}</span>
                        <span className="block text-xs capitalize text-muted-foreground">
                          {account.type}
                        </span>
                      </span>
                    </span>
                    <span
                      className={cn(
                        "text-sm font-medium tabular-nums",
                        account.net < 0 && "text-expense-strong",
                      )}
                    >
                      {formatMoney(account.net, currency)}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <LocalDbStatus />

      {/* Reached from here rather than from the transaction form: "set up rent"
          is a one-off decision a user makes once, and a checkbox on every
          transaction entry is not where anyone goes looking for it. */}
      <Link
        href="/recurring"
        className="flex items-center justify-between gap-3 rounded-2xl border border-dashed p-4 text-sm transition-colors hover:bg-accent/50"
      >
        <span>
          <span className="block font-medium">Rent, salary, subscriptions</span>
          <span className="mt-0.5 block text-xs text-muted-foreground">
            Set up money that repeats, and confirm it each time it comes round.
          </span>
        </span>
        <Repeat className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
      </Link>
    </div>
  );
}