"use client";

import { ArrowLeft, Pencil } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import AccountForm from "@/components/account-form";
import { useAccounts } from "@/hooks/use-accounts";

export default function NewAccountPage() {
  const accounts = useAccounts();
  const router = useRouter();

  // With no accounts at all, "back" would land on a list that is empty anyway —
  // send those users to the transaction they were trying to log, since that was
  // the thing that brought them here.
  const back = accounts.length === 0 ? "/transactions/new" : "/accounts";

  return (
    <div className="mx-auto w-full max-w-md">
      <Link
        href={back}
        className="mb-4 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back
      </Link>

      <span className="mb-1 flex size-11 items-center justify-center rounded-2xl bg-primary-subtle text-primary">
        <Pencil className="size-5" aria-hidden="true" />
      </span>

      <h1 className="text-2xl font-semibold tracking-tight">New account</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        A bank account, a wallet, a savings pot — wherever money sits for you.
      </p>

      <AccountForm onDone={() => router.push("/accounts")} />
    </div>
  );
}