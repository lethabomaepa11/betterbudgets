"use client";

import { useState } from "react";

import { cn } from "@betterbudgets/ui/lib/utils";
import { ArrowDownLeft, ArrowUpRight, Check, Loader2, X } from "lucide-react";

import {
  canCover,
  confirmOccurrence,
  duePhrase,
  skipOccurrence,
  today,
  urgencyOf,
  type OccurrenceRow,
} from "@/lib/local-db";
import { useLocalDb } from "@/lib/local-db/provider";
import { useVault } from "@/lib/local-db/vault";

/**
 * The money that needs a decision: "confirm you received this", "pay this",
 * "skip this one".
 *
 * Deliberately the first thing on the dashboard. Everything else on that screen
 * reports what already happened; this is the only part that asks something of
 * the user, so burying it under a balance total would waste the one moment the
 * app has their attention.
 *
 * Each row confirms through an explicit dialog rather than a single tap. Paying
 * rent is not undoable from the user's side, and a column of one-tap buttons
 * where the wrong one costs money is not a safe design.
 */
export default function NeedsYou({
  rows,
  balance,
  currency,
}: {
  rows: OccurrenceRow[];
  /** Available across the accounts these rows draw on, in minor units. */
  balance: number;
  currency: string;
}) {
  const { db } = useLocalDb();
  const { activeProfile } = useVault();

  const [confirming, setConfirming] = useState<OccurrenceRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const format = (minor: number) =>
    new Intl.NumberFormat(undefined, { style: "currency", currency }).format(minor / 100);

  /**
   * Money arriving on or before each due date, as a running total.
   *
   * Prefixed totals rather than a per-row sum: rent due on the 1st can be covered
   * by a salary due on the 30th *and* one due on the 15th of the same month, but
   * not by a salary due after the 1st. Summing only the qualifying inflows is
   * what makes that ordering come out right.
   */
  const incomingByDueDate = new Map<string, number>();
  {
    const inflows = rows
      .filter((row) => row.type === "inflow")
      .sort((a, b) => a.due_on.localeCompare(b.due_on));
    let running = 0;
    for (const row of inflows) {
      running += row.amount;
      incomingByDueDate.set(row.due_on, running);
    }
    // Any due date at or after the last inflow should still see that total.
    const lastDue = rows.reduce((latest, row) => (row.due_on > latest ? row.due_on : latest), "");
    if (lastDue && running > 0 && !incomingByDueDate.has(lastDue)) {
      incomingByDueDate.set(lastDue, running);
    }
  }

  if (rows.length === 0) return null;

  async function settle(row: OccurrenceRow, action: "pay" | "skip") {
    if (!db || !activeProfile) return;
    setBusy(true);
    setError(null);
    try {
      if (action === "pay") {
        await confirmOccurrence(db, activeProfile.id, row.id, today());
        setConfirming(null);
      } else {
        await skipOccurrence(db, activeProfile.id, row.id);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't record that.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="needs-you-heading" className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="needs-you-heading" className="text-sm font-medium">
          Needs you
        </h2>
        <span className="text-xs text-muted-foreground">
          {rows.length} {rows.length === 1 ? "item" : "items"}
        </span>
      </div>

      {error && (
        <p role="alert" className="text-sm text-expense-strong">
          {error}
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {rows.map((row) => (
          <NeedsYouRow
            key={row.id}
            row={row}
            balance={balance}
            format={format}
            incomingByDueDate={incomingByDueDate}
            busy={busy}
            open={confirming?.id === row.id}
            onAsk={() => setConfirming(row)}
            onSkip={() => void settle(row, "skip")}
            onConfirm={() => void settle(row, "pay")}
            onCancel={() => setConfirming(null)}
          />
        ))}
      </ul>
    </section>
  );
}

/**
 * One row, plus its confirm dialog when open.
 *
 * Split out so the confirm panel can hold its own state without the parent
 * re-rendering every sibling row on each keystroke of an edited amount.
 */
function NeedsYouRow({
  row,
  balance,
  format,
  incomingByDueDate,
  busy,
  open,
  onAsk,
  onSkip,
  onConfirm,
  onCancel,
}: {
  row: OccurrenceRow;
  balance: number;
  format: (minor: number) => string;
  /** Precomputed in the parent: it is the same for every row in the list. */
  incomingByDueDate: Map<string, number>;
  busy: boolean;
  open: boolean;
  onAsk: () => void;
  onSkip: () => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const urgency = urgencyOf(row.daysUntil);
  const inflow = row.type === "inflow";

  return (
    <li
      className={cn(
        "rounded-2xl border bg-card p-4",
        urgency === "overdue" || urgency === "today" ? "border-foreground/20" : "border-border",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            {inflow ? (
              <ArrowDownLeft className="size-4 shrink-0 text-income-strong" aria-hidden="true" />
            ) : (
              <ArrowUpRight className="size-4 shrink-0 text-expense-strong" aria-hidden="true" />
            )}
            <span className="truncate">{row.name ?? "Something"}</span>
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {format(row.amount)} · {row.accountName}
            {row.frequencyLabel ? ` · ${row.frequencyLabel}` : ""}
          </p>
          <DueLine
            row={row}
            balance={balance}
            format={format}
            inflow={inflow}
            incoming={incomingByDueDate.get(row.due_on) ?? 0}
          />
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <button
            type="button"
            onClick={onAsk}
            disabled={busy}
            className="flex h-9 items-center gap-1.5 rounded-xl bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Check className="size-3.5" aria-hidden="true" />
            )}
            {inflow ? "Got it" : "Paid"}
          </button>
          <button
            type="button"
            onClick={onSkip}
            disabled={busy}
            className="h-9 rounded-xl px-3 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
          >
            Skip
          </button>
        </div>
      </div>

      {open && (
        <ConfirmDialog
          row={row}
          format={format}
          busy={busy}
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      )}
    </li>
  );
}

/** "due in 3 days", coloured by urgency, plus whether the balance covers it. */
function DueLine({
  row,
  balance,
  format,
  inflow,
  incoming,
}: {
  row: OccurrenceRow;
  balance: number;
  format: (minor: number) => string;
  inflow: boolean;
  /** Money already expected to arrive on or before this row's due date. */
  incoming: number;
}) {
  const urgency = urgencyOf(row.daysUntil);

  // Money on its way counts toward covering the bill. Without this, a salary due
  // on the 30th cannot help with rent on the 1st — which is the exact arrangement
  // this feature exists to model.
  const advice = inflow ? null : canCover(balance, row.amount, incoming);

  return (
    <>
      <p
        className={cn(
          "mt-1 text-xs",
          urgency === "overdue" ? "text-expense-strong" : "text-muted-foreground",
        )}
      >
        {duePhrase(row.daysUntil)}
        {advice && !advice.covered ? ` · ${format(advice.shortBy)} short` : ""}
      </p>
      {/* Only worth saying when money genuinely changes the answer. */}
      {advice?.covered && incoming > 0 && (
        <p className="mt-1 text-xs text-income-strong">{advice.message}</p>
      )}
    </>
  );
}
/**
 * The confirmation step.
 *
 * A sheet rather than a `confirm()` dialog because the wording has to state what
 * will happen to the balance, which a browser alert cannot. "Are you sure?" on a
 * row of similar buttons is not information.
 */
function ConfirmDialog({
  row,
  format,
  busy,
  onConfirm,
  onCancel,
}: {
  row: OccurrenceRow;
  format: (minor: number) => string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const inflow = row.type === "inflow";

  return (
    <div
      role="dialog"
      aria-label={inflow ? "Confirm this income" : "Confirm this payment"}
      className="mt-4 rounded-2xl border bg-background p-4"
    >
      <p className="text-sm font-medium">
        {inflow ? `Record ${format(row.amount)} coming in?` : `Record ${format(row.amount)} paid?`}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {inflow
          ? "This adds it to your balance and files it under the account above."
          : "This takes it out of your balance and counts it as spending."}
      </p>

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          className="h-11 flex-1 rounded-xl bg-primary text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-50"
        >
          {busy ? "Saving…" : inflow ? "Yes, I got it" : "Yes, I paid"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="flex size-11 items-center justify-center rounded-xl border text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
          aria-label="Cancel"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}