"use client";

import { useState } from "react";

import { ArrowLeft, Check } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import {
  createRecurring,
  describeRule,
  parseMoney,
  today,
  type MonthlyAnchor,
  type RecurringFrequency,
  type TransactionType,
} from "@/lib/local-db";
import { useLocalDb } from "@/lib/local-db/provider";
import { useVault } from "@/lib/local-db/vault";

import { useAccounts } from "@/hooks/use-accounts";
import { useCategories } from "@/hooks/use-categories";

const FIELD_CLASS =
  "mt-2 h-12 w-full rounded-2xl border border-input bg-transparent px-4 outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40";

/**
 * Sets up money that repeats: rent, a salary, a subscription.
 *
 * Two decisions shaped this form:
 *
 * - The date rule is stated in words ("last working day of the month") and shown
 *   back as a sentence. Someone setting up a bill cares about when they get
 *   paid, not about a day number, and a fixed number gets February wrong.
 * - Nothing is written until the summary is confirmed, so a half-filled rule never
 *   starts generating occurrences.
 */
export default function RecurringForm() {
  const router = useRouter();
  const { db } = useLocalDb();
  const { activeProfile } = useVault();
  const accounts = useAccounts();

  const [type, setType] = useState<TransactionType>("outflow");
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [accountId, setAccountId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [frequency, setFrequency] = useState<RecurringFrequency>("monthly");
  const [anchor, setAnchor] = useState<MonthlyAnchor>("day_of_month");
  const [firstDate, setFirstDate] = useState(today());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A category's `kind` is the same axis as a transaction's `type` (money in vs
  // money out) but is spelled differently in the model, so the mapping is
  // explicit. Offering an income category on an expense would be nonsense.
  const categories = useCategories(type === "inflow" ? "income" : "expense");
  const account = accountId || accounts[0]?.id || "";

  const minor = parseMoney(amount);
  const canSave = Boolean(name.trim() && minor !== null && minor > 0 && account);

  // Shown back before saving, so the rule is never a surprise afterwards.
  const summary = describeRule({
    frequency,
    anchor,
    dayOfMonth: Number(firstDate.slice(8, 10)) || 1,
  });

  async function save() {
    if (!db || !activeProfile || !canSave || minor === null) return;
    setSaving(true);
    setError(null);
    try {
      await createRecurring(db, activeProfile.id, {
        accountId: account,
        categoryId: categoryId || null,
        name: name.trim(),
        amount: minor,
        type,
        frequency,
        anchor: frequency === "monthly" ? anchor : undefined,
        startsOn: firstDate,
      });
      router.push("/dashboard");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't save that.");
      setSaving(false);
    }
  }

  if (accounts.length === 0) {
    return (
      <div className="mx-auto w-full max-w-md space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">Set up repeating money</h1>
        <p className="text-sm text-muted-foreground">
          You need an account before money can land somewhere. Add one first.
        </p>
        <Link
          href="/accounts/new"
          className="inline-flex h-11 items-center rounded-2xl bg-primary px-5 text-sm font-medium text-primary-foreground"
        >
          Add an account
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-md">
      <Link
        href="/dashboard"
        className="mb-4 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back
      </Link>

      <h1 className="mb-1 text-2xl font-semibold tracking-tight">Set up repeating money</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Rent, a salary, a subscription. It appears as something to confirm when it's due.
      </p>

      <div className="flex flex-col gap-6">
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Money coming in or going out</legend>
          <div className="grid grid-cols-2 gap-2">
            {(["outflow", "inflow"] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={type === option}
                onClick={() => {
                  setType(option);
                  // The category list is filtered by direction, so a category
                  // picked under the other direction is no longer valid.
                  setCategoryId("");
                }}
                className={`h-12 rounded-2xl border text-sm font-medium transition-colors ${
                  type === option
                    ? "border-primary bg-primary-subtle text-primary"
                    : "border-input hover:bg-accent/50"
                }`}
              >
                {option === "outflow" ? "Money out" : "Money in"}
              </button>
            ))}
          </div>
        </fieldset>

        <label className="block text-sm font-medium">
          What is it
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={type === "outflow" ? "Rent" : "Salary"}
            className={FIELD_CLASS}
          />
        </label>

        <label className="block text-sm font-medium">
          How much
          <input
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            inputMode="decimal"
            placeholder="0.00"
            className={`${FIELD_CLASS} tabular-nums`}
          />
        </label>

        <label className="block text-sm font-medium">
          Which account
          <select
            value={account}
            onChange={(event) => setAccountId(event.target.value)}
            className={FIELD_CLASS}
          >
            {accounts.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </label>

        {categories.length > 0 && (
          <label className="block text-sm font-medium">
            Category
            <select
              value={categoryId}
              onChange={(event) => setCategoryId(event.target.value)}
              className={FIELD_CLASS}
            >
              <option value="">No category</option>
              {categories.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">How often</legend>
          <div className="grid grid-cols-3 gap-2">
            {(["weekly", "monthly", "yearly"] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={frequency === option}
                onClick={() => setFrequency(option)}
                className={`h-11 rounded-2xl border text-sm font-medium capitalize transition-colors ${
                  frequency === option
                    ? "border-primary bg-primary-subtle text-primary"
                    : "border-input hover:bg-accent/50"
                }`}
              >
                {option}
              </button>
            ))}
          </div>
        </fieldset>

        {frequency === "monthly" && (
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Which day</legend>
            <div className="grid gap-2">
              {MONTH_DAY_OPTIONS(firstDate).map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={anchor === option.value}
                  onClick={() => setAnchor(option.value)}
                  className={`flex h-11 items-center gap-2 rounded-2xl border px-4 text-left text-sm transition-colors ${
                    anchor === option.value
                      ? "border-primary bg-primary-subtle text-primary"
                      : "border-input hover:bg-accent/50"
                  }`}
                >
                  {anchor === option.value && <Check className="size-4 shrink-0" aria-hidden="true" />}
                  {option.label}
                </button>
              ))}
            </div>
          </fieldset>
        )}

        <label className="block text-sm font-medium">
          First one is due
          <input
            type="date"
            value={firstDate}
            onChange={(event) => setFirstDate(event.target.value)}
            className={FIELD_CLASS}
          />
        </label>

        <p className="rounded-2xl bg-muted/50 p-4 text-sm text-muted-foreground">
          {name.trim() || "This"} · {summary}.
        </p>

        {error && (
          <p role="alert" className="text-sm text-expense-strong">
            {error}
          </p>
        )}

        <button
          type="button"
          onClick={() => void save()}
          disabled={!canSave || saving}
          className="h-14 w-full rounded-2xl bg-primary text-base font-medium text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-50"
        >
          {saving ? "Saving…" : "Set it up"}
        </button>
      </div>
    </div>
  );
}

/**
 * The monthly choices, labelled from the chosen first date.
 *
 * A function rather than a constant because the "day N" option has to follow
 * whichever date is currently set — otherwise picking the 25th and then reading
 * "Day 5" on the button would quietly create a different series.
 */
function MONTH_DAY_OPTIONS(firstDate: string) {
  const day = Number(firstDate.slice(8, 10)) || 1;
  return [
    { value: "day_of_month" as const, label: `Day ${day} of the month` },
    { value: "last_day" as const, label: "Last day of the month" },
    { value: "last_weekday" as const, label: "Last working day of the month" },
    { value: "first_weekday" as const, label: "First Monday of the month" },
  ];
}