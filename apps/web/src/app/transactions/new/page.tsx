"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import TransactionForm from "@/components/transaction-form";
import { useAccounts } from "@/hooks/use-accounts";

/**
 * The centre button's destination: log a transaction.
 *
 * A page rather than a dialog on purpose. Adding a transaction is the app's
 * primary action, so it gets a full screen with room for amount, account, note,
 * date and recurrence — a sheet would have to drop one of them on a phone.
 */
export default function NewTransactionPage() {
  const accounts = useAccounts();

  return (
    <div className="mx-auto w-full max-w-md">
      <Link
        href="/dashboard"
        className="mb-4 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back
      </Link>

      <h1 className="mb-1 text-2xl font-semibold tracking-tight">New transaction</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Saved to this device, straight away.
      </p>

      <TransactionForm accounts={accounts} onDone={() => history.back()} />
    </div>
  );
}