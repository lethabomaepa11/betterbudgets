"use client";

import { useEffect, useMemo, useState } from "react";

import { ArrowLeft, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";

import TransactionForm from "@/components/transaction-form";
import TransactionRow from "@/components/transaction-row";
import {
  formatMoney,
  type Account,
  type AccountType,
  type Transaction,
} from "@/lib/local-db";
import { useLocalDb } from "@/lib/local-db/provider";
import { useAutoRefresh, useVault } from "@/lib/local-db/vault";

import { useAccounts } from "@/hooks/use-accounts";

type Panel = "list" | "add" | "edit";

const TYPE_LABEL: Record<AccountType, string> = {
  checking: "Bank account",
  savings: "Savings",
  credit: "Credit card",
  cash: "Cash",
  investment: "Investment",
  other: "Other",
};

/**
 * One account: its running balance, everything logged against it, and the
 * actions for adding, editing or archiving.
 *
 * The panels switch in place rather than routing to separate pages. Adding a
 * transaction is a one-shot task that should return you to where you were, so a
 * dialog-shaped interaction fits better than a new URL.
 */
export default function AccountDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const accountId = params.id;

  const { ledger } = useLocalDb();
  const { activeProfile, dataChanged } = useVault();
  const accounts = useAccounts();

  const currency = activeProfile?.currency ?? "USD";
  const [account, setAccount] = useState<Account | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [panel, setPanel] = useState<Panel>("list");
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  // Set when a recurring occurrence is awaiting a scope choice; null otherwise.
  const [pendingRemoval, setPendingRemoval] = useState<Transaction | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Re-reads after any write, so a transaction added here shows up on the
  // account's balance without needing a manual refresh.
  const refreshVersion = useAutoRefresh(`${activeProfile?.id}:${accountId}`);

  // The running total is computed from the transactions, not read off the stored
  // `balance` column, which is only ever the opening figure.
  const net = useMemo(
    () => accounts.find((row) => row.id === accountId)?.net ?? null,
    [accounts, accountId],
  );

  const accountChoices = useMemo(
    () => accounts.map((row) => ({ id: row.id, name: row.name })),
    [accounts],
  );

  useEffect(() => {
    if (!ledger || !activeProfile) return;
    let cancelled = false;

    void (async () => {
      const [row, list] = await Promise.all([
        ledger.getAccount(activeProfile.id, accountId),
        ledger.listAccountTransactions(activeProfile.id, accountId),
      ]);
      if (cancelled) return;
      setAccount(row);
      setTransactions(list);
    })().catch((cause: unknown) => {
      if (!cancelled) {
        setError(cause instanceof Error ? cause.message : "Couldn't load that account.");
      }
    });

    return () => {
      cancelled = true;
    };
  }, [ledger, activeProfile, accountId, refreshVersion]);

  async function archive() {
    if (!ledger || !activeProfile) return;
    setMenuOpen(false);
    try {
      await ledger.archiveAccount(activeProfile.id, accountId);
      dataChanged();
      router.push("/accounts");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't archive that.");
      setMenuOpen(true);
    }
  }

  /**
   * Removing a generated occurrence is two genuinely different actions, so they
   * get a real choice rather than a confirm() whose meaning depends on which
   * button the user happened to press. A dismissable sheet is used rather than
   * `confirm()` so the wording can say what each option will actually do.
   */
  function askHowToRemove(transaction: Transaction) {
    // A plain transaction has only one possible outcome, so it just goes.
    if (!transaction.recurring_id) {
      void remove(transaction, "this");
      return;
    }
    setPendingRemoval(transaction);
  }

  async function remove(transaction: Transaction, scope: "this" | "future") {
    if (!ledger || !activeProfile) return;
    setPendingRemoval(null);
    try {
      await ledger.deleteTransaction(activeProfile.id, transaction.id, { scope });
      dataChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't remove that.");
    }
  }
if (error && !account) {
    return (
      <div className="mx-auto w-full max-w-md space-y-4">
        <Link
          href="/accounts"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Back
        </Link>
        <p role="alert" className="text-sm text-expense-strong">
          {error}
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-6">
      <div>
        <Link
          href="/accounts"
          className="mb-3 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Accounts
        </Link>

        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold tracking-tight">
              {account?.name ?? "Account"}
            </h1>
            {account && (
              <p className="text-sm text-muted-foreground">{TYPE_LABEL[account.type]}</p>
            )}
          </div>

          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
              aria-expanded={menuOpen}
              aria-label="Account actions"
              className="flex size-10 items-center justify-center rounded-full hover:bg-accent"
            >
              <MoreHorizontal className="size-5" aria-hidden="true" />
            </button>

            {menuOpen && (
              <>
                {/* Click-away catcher: without it the menu can only be dismissed
                    by choosing something, trapping the user mid-decision. */}
                <button
                  type="button"
                  aria-label="Close menu"
                  className="fixed inset-0 z-10 cursor-default"
                  onClick={() => setMenuOpen(false)}
                />
                <div className="absolute right-0 z-20 mt-1 w-48 overflow-hidden rounded-2xl bg-card shadow-card ring-1 ring-foreground/10">
                  <button
                    type="button"
                    onClick={archive}
                    className="flex w-full items-center gap-2 px-4 py-3 text-sm text-expense-strong transition-colors hover:bg-destructive/10"
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                    Archive account
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        {net !== null && (
          <p className="mt-4 text-3xl font-semibold tracking-tight tabular-nums">
            {formatMoney(net, currency)}
          </p>
        )}
      </div>

      {panel === "list" && (
        <>
          <button
            type="button"
            onClick={() => setPanel("add")}
            className="h-12 w-full rounded-2xl bg-primary text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover"
          >
            Add a transaction
          </button>

          {error && (
            <p role="alert" className="text-sm text-expense-strong">
              {error}
            </p>
          )}

          {transactions.length === 0 ? (
            <p className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
              Nothing logged here yet.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {transactions.map((transaction) => (
                <TransactionRow
                  key={transaction.id}
                  transaction={transaction}
                  currency={currency}
                  actions={
                    <>
                      <button
                        type="button"
                        aria-label="Edit"
                        onClick={() => {
                          setEditing(transaction);
                          setPanel("edit");
                        }}
                        className="flex size-8 items-center justify-center rounded-full hover:bg-accent"
                      >
                        <Pencil className="size-4" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        aria-label="Remove"
                        onClick={() => askHowToRemove(transaction)}
                        className="flex size-8 items-center justify-center rounded-full text-expense-strong hover:bg-destructive/10"
                      >
                        <Trash2 className="size-4" aria-hidden="true" />
                      </button>
                    </>
                  }
                />
              ))}
            </ul>
          )}
        </>
      )}

      {panel === "add" && (
        <>
          <h2 className="text-base font-medium">New transaction</h2>
          <TransactionForm
            accounts={accountChoices}
            defaultAccountId={accountId}
            onDone={() => setPanel("list")}
          />
        </>
      )}

      {panel === "edit" && editing && (
        <>
          <h2 className="text-base font-medium">Edit transaction</h2>
          <TransactionForm
            transaction={editing}
            accounts={accountChoices}
            onDone={() => {
              setEditing(null);
              setPanel("list");
            }}
          />
        </>
      )}

      {/* Scope choice for a recurring occurrence. Rendered as an inline sheet so
          each option can state exactly what it will remove — a single confirm()
          button cannot do that honestly. */}
      {pendingRemoval && (
        <>
          <button
            type="button"
            aria-label="Dismiss"
            className="fixed inset-0 z-30 cursor-default bg-foreground/20"
            onClick={() => setPendingRemoval(null)}
          />
          <div
            role="dialog"
            aria-label="Remove recurring transaction"
            className="fixed inset-x-4 bottom-4 z-40 mx-auto max-w-sm rounded-3xl bg-card p-5 shadow-card ring-1 ring-foreground/10"
          >
            <h2 className="text-base font-medium">Remove this one</h2>
            <p className="mt-1.5 text-sm text-muted-foreground">
              {pendingRemoval.name ?? "This transaction"} is recurring. Do you want to skip
              just this one, or stop the whole series?
            </p>

            <div className="mt-4 flex flex-col gap-2">
              <button
                type="button"
                onClick={() => void remove(pendingRemoval, "this")}
                className="h-12 w-full rounded-2xl bg-primary text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover"
              >
                Just this one
              </button>
              <button
                type="button"
                onClick={() => void remove(pendingRemoval, "future")}
                className="h-12 w-full rounded-2xl bg-destructive/10 text-sm font-medium text-destructive transition-colors hover:bg-destructive/20"
              >
                This and every future one
              </button>
              <button
                type="button"
                onClick={() => setPendingRemoval(null)}
                className="h-11 w-full rounded-2xl text-sm text-muted-foreground transition-colors hover:bg-accent"
              >
                Keep it
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}