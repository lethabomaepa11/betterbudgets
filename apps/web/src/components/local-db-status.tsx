"use client";

import { cn } from "@betterbudgets/ui/lib/utils";
import { AlertTriangle, Loader2, RefreshCcw } from "lucide-react";

import { useLocalDb } from "@/lib/local-db/provider";

/**
 * Reports where the ledger is actually being persisted. Worth surfacing rather
 * than hiding: a user in a private window should be told their entries are
 * transient *before* they trust them with a month of spending — and a user
 * whose worker never boots should get a visible way out instead of a spinner.
 */
export default function LocalDbStatus({ className }: { className?: string }) {
  const { status, storage, reason, retry } = useLocalDb();

  if (status === "opening") {
    return (
      <p className={cn("flex items-center gap-2 text-xs text-muted-foreground", className)}>
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        Opening your local database…
      </p>
    );
  }

  if (status === "unavailable") {
    return (
      <div className={cn("flex flex-col items-center gap-2 text-center", className)}>
        <p
          className="flex items-center gap-2 text-xs text-expense-strong"
          title={reason ?? undefined}
        >
          <AlertTriangle className="size-4" aria-hidden="true" />
          Couldn&apos;t open local storage
        </p>
        <button
          type="button"
          onClick={retry}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium",
            "text-primary-foreground bg-primary transition-colors hover:bg-primary-hover",
          )}
        >
          <RefreshCcw className="size-3.5" aria-hidden="true" />
          Try again
        </button>
      </div>
    );
  }

  return (
    <p
      className={cn(
        "flex items-center gap-2 text-xs",
        storage === "opfs" ? "text-income-strong" : "text-warning-strong",
        className,
      )}
      title={reason ?? undefined}
    >
      {storage === "opfs"
        ? "Saved on this device."
        : "Temporary storage — entries will not survive a reload."}
    </p>
  );
}
