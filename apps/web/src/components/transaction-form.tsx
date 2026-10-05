"use client";

import { useState } from "react";

import type { Route } from "next";
import { useRouter } from "next/navigation";

import { Button } from "@betterbudgets/ui/components/button";
import { useLocalDb } from "@/lib/local-db/provider";
import { parseMoney, today, type TransactionType } from "@/lib/local-db";
import { useVault } from "@/lib/local-db/vault";

import { useCategories } from "@/hooks/use-categories";

/** Highlight colours per direction, keyed by the model's own vocabulary. */
const TONE: Record<TransactionType, string> = {
  /** "Money out" — a cost, a bill, something that left the account. */
  outflow: "bg-expense-subtle text-expense-strong",
  /** "Money in" — salary, a refund, anything that arrived. */
  inflow: "bg-income-subtle text-income-strong",
};

const FIELD_CLASS =
  "mt-2 h-12 w-full rounded-2xl border border-input bg-transparent px-4 outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40";

/** The subset of a transaction this form needs, so callers can pass a full row. */
export type EditableTransaction = {
  id: string;
  name: string | null;
  amount: number;
  type: TransactionType;
  account_id: string;
  source_account_id: string | null;
  occurred_on: string;
  /** Added in schema v4. */
  category_id: string | null;
};

/**
 * The one form for creating and editing a transaction.
 *
 * Both are the same shape — same fields, same validation, same write — so
 * splitting them means two places to change every time the model does. When
 * `transaction` is supplied it edits that row in place; otherwise it creates one.
 * `onDone` decides where the user lands afterwards.
 */
export default function TransactionForm({
  transaction,
  accounts,
  defaultAccountId,
  onDone,
}: {
  /** Present when editing. Omit to create. */
  transaction?: EditableTransaction;
  accounts: { id: string; name: string }[];
  defaultAccountId?: string;
  onDone: () => void;
}) {
  const { ledger } = useLocalDb();
  const { activeProfile, dataChanged } = useVault();
  const router = useRouter();

  const editing = Boolean(transaction);

  // `outflow` (not "expense") is the model's word for money leaving; the UI says
  // "Money out" so the user never has to learn the database's vocabulary.
  const [type, setType] = useState<TransactionType>(
    transaction?.type ?? "outflow",
  );
  const [isTransfer, setIsTransfer] = useState(Boolean(transaction?.source_account_id));
  const [categoryId, setCategoryId] = useState<string>(
    transaction?.category_id ?? "",
  );
  const [amount, setAmount] = useState(
    transaction ? (transaction.amount / 100).toFixed(2) : "",
  );
  const [name, setName] = useState(transaction?.name ?? "");
  const [accountId, setAccountId] = useState(
    transaction?.account_id ?? defaultAccountId ?? accounts[0]?.id ?? "",
  );
  const [sourceAccountId, setSourceAccountId] = useState(
    transaction?.source_account_id ?? "",
  );
  const [occurredOn, setOccurredOn] = useState(transaction?.occurred_on ?? today());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Categories follow the direction: switching from "Money out" to "Money in"
  // has to swap the list, and a category from the other direction would file a
  // salary under Rent. Declared here because it reads `type`.
  const categories = useCategories(type === "inflow" ? "income" : "expense");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!ledger || !activeProfile) return;

    // Parsed on submit rather than per keystroke, so a half-typed "19." never
    // blocks the form, and the stored value is always whole cents.
    const minor = parseMoney(amount);
    if (minor === null || minor < 0) {
      setError("Enter an amount, like 24.99");
      return;
    }
    if (!accountId) {
      setError("Choose an account.");
      return;
    }
    if (isTransfer && (!sourceAccountId || sourceAccountId === accountId)) {
      setError("Choose two different accounts for a transfer.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      if (editing && transaction) {
        await ledger.updateTransaction(activeProfile.id, transaction.id, {
          name: name.trim() || null,
          amount: minor,
          type: isTransfer ? "inflow" : type,
          accountId,
          occurredOn,
          categoryId: isTransfer ? null : categoryId || null,
          sourceAccountId: isTransfer ? sourceAccountId : null,
        });
      } else {
        await ledger.addTransaction(activeProfile.id, {
          accountId,
          amount: minor,
          type: isTransfer ? "inflow" : type,
          occurredOn,
          name: name.trim() || null,
          categoryId: isTransfer ? null : categoryId || null,
          sourceAccountId: isTransfer ? sourceAccountId : null,
        });
      }

      // Announce the write before navigating, so the screen the user lands on
      // reads fresh rather than rendering numbers from a stale read.
      dataChanged();
      onDone();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't save that.");
      setSaving(false);
    }
  }

  // A transaction cannot exist without an account, so with none created yet the
  // only useful action is to go and make one. Caught here at the top rather than
  // as a confusing failure on submit. `onDone` is not a usable escape from here:
  // callers pass it as "go back", which would land the user on the form they just
  // found empty, so this navigates explicitly.
  if (accounts.length === 0) {
    return (
      <div className="rounded-3xl bg-card p-6 text-center shadow-card ring-1 ring-foreground/6">
        <p className="text-sm text-muted-foreground">
          Add an account first — every transaction is recorded against one.
        </p>
        <Button className="mt-4" onClick={() => router.push("/accounts/new" as Route)}>
          Add an account
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <fieldset className="grid grid-cols-3 gap-2">
        <legend className="sr-only">Transaction type</legend>
        {(["outflow", "inflow"] as const).map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={!isTransfer && type === option}
            onClick={() => {
              setIsTransfer(false);
              setType(option);
              setSourceAccountId("");
              setCategoryId("");
            }}
            className={`h-12 rounded-2xl text-sm font-medium transition-colors ${
              !isTransfer && type === option ? TONE[option] : "bg-muted text-muted-foreground"
            }`}
          >
            {option === "inflow" ? "Money in" : "Money out"}
          </button>
        ))}
        <button
          type="button"
          aria-pressed={isTransfer}
          onClick={() => {
            setIsTransfer(true);
            setType("inflow");
            setCategoryId("");
          }}
          className={`h-12 rounded-2xl text-sm font-medium transition-colors ${
            isTransfer ? "bg-primary-subtle text-primary" : "bg-muted text-muted-foreground"
          }`}
        >
          Transfer
        </button>
      </fieldset>

      <label className="block">
        <span className="text-sm font-medium">Amount</span>
        <input
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          inputMode="decimal"
          autoFocus
          placeholder="0.00"
          className="mt-2 h-14 w-full rounded-2xl border border-input bg-transparent px-4 text-2xl font-semibold tabular-nums outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
        />
      </label>

      <label className="block">
        <span className="text-sm font-medium">{isTransfer ? "To account" : "Account"}</span>
        <select
          value={accountId}
          onChange={(event) => setAccountId(event.target.value)}
          className={FIELD_CLASS}
        >
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </select>
      </label>

      {isTransfer && (
        <label className="block">
          <span className="text-sm font-medium">From account</span>
          <select
            value={sourceAccountId}
            onChange={(event) => setSourceAccountId(event.target.value)}
            className={FIELD_CLASS}
          >
            <option value="">Choose an account</option>
            {accounts
              .filter((account) => account.id !== accountId)
              .map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
          </select>
          <span className="mt-1.5 block text-xs text-muted-foreground">
            The amount leaves this account and arrives in the destination above.
          </span>
        </label>
      )}

      {/* Only rendered once categories exist: an empty dropdown teaches nothing and
          adds a tap to the common path. The transaction is still perfectly valid
          without one — `category_id` is nullable by design. */}
      {!isTransfer && categories.length > 0 && (
        <label className="block">
          <span className="text-sm font-medium">Category</span>
          <select
            value={categoryId}
            onChange={(event) => setCategoryId(event.target.value)}
            className={FIELD_CLASS}
          >
            <option value="">None</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <label className="block">
        <span className="text-sm font-medium">Note</span>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={type === "inflow" ? "Salary" : "Groceries"}
          className={FIELD_CLASS}
        />
      </label>

      <label className="block">
        <span className="text-sm font-medium">Date</span>
        <input
          type="date"
          value={occurredOn}
          onChange={(event) => setOccurredOn(event.target.value)}
          className={FIELD_CLASS}
        />
      </label>

      {error && (
        <p role="alert" className="text-sm text-expense-strong">
          {error}
        </p>
      )}

      <Button type="submit" size="lg" disabled={saving} className="h-14 w-full rounded-2xl text-base">
        {saving ? "Saving…" : editing ? "Save changes" : "Save transaction"}
      </Button>
    </form>
  );
}