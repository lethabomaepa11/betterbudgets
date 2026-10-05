"use client";

import type { Route } from "next";
import Link from "next/link";
import { ArrowUpRight, CalendarDays, CheckCircle2 } from "lucide-react";

import { formatMoney, type OccurrenceRow, urgencyOf, duePhrase } from "@/lib/local-db";
import { useOccurrences } from "@/hooks/use-occurrences";
import { useVault } from "@/lib/local-db/vault";

const WINDOW_DAYS = 7;

function urgencyClasses(daysUntil: number) {
  const urgency = urgencyOf(daysUntil);
  if (urgency === "today") return "bg-warning-subtle text-warning-strong";
  if (urgency === "soon") return "bg-primary-subtle text-primary";
  return "bg-muted text-muted-foreground";
}

function UpcomingPayment({ row, currency }: { row: OccurrenceRow; currency: string }) {
  return (
    <li className="app-dialog-panel rounded-2xl border bg-card p-4 shadow-soft transition-shadow duration-200 hover:shadow-card">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-medium">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-expense-subtle text-expense-strong">
              <ArrowUpRight className="size-4" aria-hidden="true" />
            </span>
            <span className="truncate">{row.name ?? "Upcoming payment"}</span>
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            {row.accountName}
            {row.frequencyLabel ? ` · ${row.frequencyLabel}` : ""}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-sm font-semibold tabular-nums">
            {formatMoney(row.amount, currency)}
          </p>
          <span className={`mt-2 inline-flex rounded-full px-2 py-1 text-[11px] font-medium ${urgencyClasses(row.daysUntil)}`}>
            {row.daysUntil === 0 ? "Today" : row.daysUntil === 1 ? "Tomorrow" : duePhrase(row.daysUntil)}
          </span>
        </div>
      </div>
    </li>
  );
}

export default function UpcomingPaymentsPage() {
  const { activeProfile } = useVault();
  const { rows, loading } = useOccurrences();
  const currency = activeProfile?.currency ?? "USD";
  const payments = rows
    .filter((row) => row.type === "outflow" && row.daysUntil >= 0 && row.daysUntil <= WINDOW_DAYS)
    .sort((a, b) => a.daysUntil - b.daysUntil || a.due_on.localeCompare(b.due_on));

  return (
    <div className="app-page-transition flex flex-col gap-6">
      <header className="space-y-2">
        <div className="flex items-center gap-2 text-primary">
          <CalendarDays className="size-5" aria-hidden="true" />
          <span className="text-xs font-medium uppercase tracking-[0.16em]">Next 7 days</span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Upcoming payments</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Money expected to leave your accounts from today through the next seven days.
          Confirming a payment is still handled in Needs you.
        </p>
      </header>

      {loading ? (
        <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground" role="status">
          Loading upcoming payments…
        </div>
      ) : payments.length === 0 ? (
        <div className="rounded-2xl border border-dashed p-8 text-center">
          <CheckCircle2 className="mx-auto size-8 text-income-strong" aria-hidden="true" />
          <p className="mt-3 text-sm font-medium">Nothing due in the next seven days</p>
          <p className="mt-1 text-sm text-muted-foreground">
            New recurring payments will appear here as their due dates approach.
          </p>
          <Link
            href={"/recurring" as Route}
            className="mt-4 inline-flex rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
          >
            Manage repeating money
          </Link>
        </div>
      ) : (
        <section aria-labelledby="upcoming-payments-heading">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 id="upcoming-payments-heading" className="text-sm font-medium">
              {payments.length} {payments.length === 1 ? "payment" : "payments"} ahead
            </h2>
            <span className="text-xs text-muted-foreground">Today + 7 days</span>
          </div>
          <ul className="flex flex-col gap-3">
            {payments.map((row) => (
              <UpcomingPayment key={row.id} row={row} currency={currency} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
