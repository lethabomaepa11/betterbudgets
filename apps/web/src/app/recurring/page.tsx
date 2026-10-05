"use client";

import { useEffect, useState } from "react";

import type { Route } from "next";
import { Plus, Repeat } from "lucide-react";
import Link from "next/link";

import {
  deleteRule,
  describeRule,
  formatMoney,
  listRules,
  setRuleActive,
  type RuleRow,
} from "@/lib/local-db";
import { useLocalDb } from "@/lib/local-db/provider";
import { useAutoRefresh, useVault } from "@/lib/local-db/vault";

/**
 * Manage the recurring rules: see what repeats, pause it, or remove it.
 *
 * The two destructive actions are deliberately not both buttons. Pausing is the
 * common case and is reversible, so it is a plain toggle. Removing throws away the
 * series, so it hides behind a second press that names what is lost. A row of
 * equal-looking "Pause" and "Delete" buttons is a mis-tap waiting to happen, and
 * the one you mis-tap is not the one you wanted.
 */
export default function RecurringPage() {
  const { db } = useLocalDb();
  const { activeProfile } = useVault();
  const currency = activeProfile?.currency ?? "USD";

  const [rows, setRows] = useState<RuleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useAutoRefresh(`${activeProfile?.id}:rules`);

  useEffect(() => {
    if (!db || !activeProfile) return;
    let cancelled = false;

    void listRules(db, activeProfile.id)
      .then((result) => {
        if (cancelled) return;
        setRows(result);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [db, activeProfile]);

  async function refresh() {
    if (!db || !activeProfile) return;
    setRows(await listRules(db, activeProfile.id));
  }

  async function toggle(rule: RuleRow) {
    if (!db || !activeProfile) return;
    setBusy(true);
    setError(null);
    try {
      await setRuleActive(db, activeProfile.id, rule.id, rule.isActive === 0);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't change that.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(rule: RuleRow) {
    if (!db || !activeProfile) return;
    setBusy(true);
    setError(null);
    try {
      await deleteRule(db, activeProfile.id, rule.id);
      setConfirmingDelete(null);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't remove that.");
    } finally {
      setBusy(false);
    }
  }

  const active = rows.filter((row) => row.isActive === 1);
  const paused = rows.filter((row) => row.isActive === 0);

  const shared = {
    currency,
    busy,
    confirmingDelete,
    onToggle: toggle,
    onAskDelete: setConfirmingDelete,
    onDelete: remove,
    onCancelDelete: () => setConfirmingDelete(null),
  };

  return (
    <div className="mx-auto w-full max-w-md">
      <header className="mb-6 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Repeating money</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Rent, salary, subscriptions. Each one asks you to confirm it when it comes round.
          </p>
        </div>
        <Link
          href="/recurring/new"
          aria-label="Set up repeating money"
          className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground transition-colors hover:bg-primary-hover"
        >
          <Plus className="size-5" aria-hidden="true" />
        </Link>
      </header>

      {error && (
        <p role="alert" className="mb-4 text-sm text-expense-strong">
          {error}
        </p>
      )}

      {loading ? null : rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed p-6 text-center">
          <Repeat className="mx-auto size-6 text-muted-foreground" aria-hidden="true" />
          <p className="mt-3 text-sm font-medium">Nothing repeats yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Set up your rent or your salary, and it will wait for you here each month instead of
            quietly guessing.
          </p>
          <Link
            href="/recurring/new"
            className="mt-4 inline-flex h-11 items-center rounded-2xl bg-primary px-5 text-sm font-medium text-primary-foreground"
          >
            Set up repeating money
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          {active.length > 0 && <RuleList title="Repeating" rules={active} {...shared} />}

          {/* Kept visible rather than hidden: someone who paused rent last month
              should be able to see it and switch it back on. */}
          {paused.length > 0 && <RuleList title="Paused" rules={paused} {...shared} />}
        </div>
      )}
    </div>
  );
}

/** "one coming up" / "3 coming up", so the row never reads "1 coming up". */
function pendingLabel(count: number): string {
  if (count === 1) return "one coming up";
  return `${count} coming up`;
}

function RuleList({
  title,
  rules,
  currency,
  busy,
  confirmingDelete,
  onToggle,
  onAskDelete,
  onDelete,
  onCancelDelete,
}: {
  title: string;
  rules: RuleRow[];
  currency: string;
  busy: boolean;
  confirmingDelete: string | null;
  onToggle: (rule: RuleRow) => void;
  onAskDelete: (id: string) => void;
  onDelete: (rule: RuleRow) => void;
  onCancelDelete: () => void;
}) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium">{title}</h2>
      <ul className="flex flex-col gap-2">
        {rules.map((rule) => (
          <li key={rule.id} className="rounded-2xl border bg-card p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{rule.name ?? "Untitled"}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {rule.amount === null ? "Not set up" : formatMoney(rule.amount, currency)}
                  {rule.accountName ? ` · ${rule.accountName}` : ""}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {describeRule({
                    frequency: rule.frequency,
                    anchor: rule.anchor,
                    dayOfMonth: rule.dayOfMonth,
                  })}
                </p>

                {/* Says the thing plainly rather than showing a date that will
                    never arrive: this rule cannot generate anything. */}
                {rule.incomplete ? (
                  <p className="mt-1 text-xs text-expense-strong">
                    Missing its details, so it will not ask you for anything.
                  </p>
                ) : (
                  rule.isActive === 1 && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {rule.pending === 0
                        ? "Nothing due in the next few weeks"
                        : pendingLabel(rule.pending)}
                    </p>
                  )
                )}
              </div>

              <button
                type="button"
                onClick={() => onToggle(rule)}
                disabled={busy}
                className="h-9 shrink-0 rounded-xl border px-3 text-xs font-medium transition-colors hover:bg-accent/50 disabled:opacity-50"
              >
                {rule.isActive === 1 ? "Pause" : "Resume"}
              </button>
            </div>

            {confirmingDelete === rule.id ? (
              <div className="mt-4 rounded-2xl border bg-background p-4">
                <p className="text-sm font-medium">Stop {rule.name ?? "this"} repeating?</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  It will stop asking, and anything already queued for the next few weeks goes too.
                  Payments you have already confirmed stay in your history.
                </p>
                <div className="mt-4 flex gap-2">
                  <button
                    type="button"
                    onClick={() => onDelete(rule)}
                    disabled={busy}
                    className="h-11 flex-1 rounded-xl bg-expense-strong text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                  >
                    {busy ? "Removing…" : "Yes, stop it"}
                  </button>
                  <button
                    type="button"
                    onClick={onCancelDelete}
                    disabled={busy}
                    className="h-11 rounded-xl border px-4 text-sm text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                  >
                    Keep it
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => onAskDelete(rule.id)}
                disabled={busy}
                className="mt-3 text-xs text-muted-foreground underline underline-offset-4 transition-colors hover:text-expense-strong disabled:opacity-50"
              >
                Remove this series
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}