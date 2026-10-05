"use client";

import { useState } from "react";

import { Button } from "@betterbudgets/ui/components/button";
import type { AccountType } from "@/lib/local-db";
import { parseMoney } from "@/lib/local-db";
import { useLocalDb } from "@/lib/local-db/provider";
import { useVault } from "@/lib/local-db/vault";

const TYPES: readonly {
  value: AccountType;
  label: string;
  hint: string;
}[] = [
  { value: "checking", label: "Bank account", hint: "Everyday money, salary lands here" },
  { value: "savings", label: "Savings", hint: "Emergency fund, goal pots" },
  { value: "credit", label: "Credit card", hint: "Something you pay off later" },
  { value: "cash", label: "Cash", hint: "What is in your wallet" },
  { value: "investment", label: "Investment", hint: "Brokerage, pension" },
  { value: "other", label: "Other", hint: "Anything else" },
];

const FIELD_CLASS =
  "mt-2 h-12 w-full rounded-2xl border border-input bg-transparent px-4 outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40";

/**
 * Create or rename an account.
 *
 * One component for both because the only difference is which repository call
 * runs afterwards, and two near-identical forms is how the labels drift apart.
 */
export default function AccountForm({
  account,
  onDone,
}: {
  /** Present when editing an existing account. */
  account?: { id: string; name: string; type: AccountType };
  onDone: () => void;
}) {
  const { ledger } = useLocalDb();
  const { activeProfile, dataChanged } = useVault();

  const editing = Boolean(account);

  const [name, setName] = useState(account?.name ?? "");
  const [type, setType] = useState<AccountType>(account?.type ?? "checking");
  const [openingBalance, setOpeningBalance] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!ledger || !activeProfile) return;

    if (!name.trim()) {
      setError("Give the account a name.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      if (editing && account) {
        await ledger.updateAccount(activeProfile.id, account.id, {
          name: name.trim(),
          type,
        });
      } else {
        // The opening balance is optional and is the account's starting figure
        // rather than a running one — every transaction adjusts it from there.
        const balance = openingBalance.trim() ? parseMoney(openingBalance) : null;
        if (openingBalance.trim() && balance === null) {
          setError("That starting balance isn't a number.");
          setSaving(false);
          return;
        }
        await ledger.createAccount(activeProfile.id, {
          name: name.trim(),
          type,
          balance,
        });
      }

      dataChanged();
      onDone();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't save that.");
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <label className="block">
        <span className="text-sm font-medium">Name</span>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Everyday account"
          autoFocus
          className={FIELD_CLASS}
        />
      </label>

      <fieldset>
        <legend className="text-sm font-medium">Type</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {TYPES.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={type === option.value}
              onClick={() => setType(option.value)}
              className={`rounded-2xl border p-3 text-left transition-colors ${
                type === option.value
                  ? "border-primary bg-primary-subtle"
                  : "border-input hover:bg-accent/50"
              }`}
            >
              <span className="block text-sm font-medium">{option.label}</span>
              <span className="block text-xs text-muted-foreground">{option.hint}</span>
            </button>
          ))}
        </div>
      </fieldset>

      {!editing && (
        <label className="block">
          <span className="text-sm font-medium">Starting balance</span>
          <input
            value={openingBalance}
            onChange={(event) => setOpeningBalance(event.target.value)}
            inputMode="decimal"
            placeholder="Optional"
            className={FIELD_CLASS}
          />
          <span className="mt-1.5 block text-xs text-muted-foreground">
            What&apos;s in it today. Later transactions are added to this.
          </span>
        </label>
      )}

      {error && (
        <p role="alert" className="text-sm text-expense-strong">
          {error}
        </p>
      )}

      <Button type="submit" size="lg" disabled={saving} className="h-14 w-full rounded-2xl text-base">
        {saving ? "Saving…" : editing ? "Save changes" : "Create account"}
      </Button>
    </form>
  );
}