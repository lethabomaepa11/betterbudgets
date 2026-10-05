"use client";

import { useEffect, useState } from "react";

import { useLocalDb } from "@/lib/local-db/provider";
import type { AccountWithTotals } from "@/lib/local-db";
import { useAutoRefresh, useVault } from "@/lib/local-db/vault";

/**
 * Every account the active profile owns, re-read whenever the vault reports a
 * write.
 *
 * The account list is needed by the transaction form, the account screens and
 * the new/edit forms, all of which want the same rows — so it is read once here
 * rather than three times with three slightly different filters.
 */
export function useAccounts(): AccountWithTotals[] {
  const { ledger } = useLocalDb();
  const { activeProfile } = useVault();
  const [accounts, setAccounts] = useState<AccountWithTotals[]>([]);

  useAutoRefresh(activeProfile?.id);

  useEffect(() => {
    if (!ledger || !activeProfile) return;
    let cancelled = false;

    void ledger
      .listAccountsWithTotals(activeProfile.id)
      .then((rows) => {
        if (!cancelled) setAccounts(rows);
      })
      .catch(() => {
        /* Leave the list empty; each screen has an empty state for it. */
      });

    return () => {
      cancelled = true;
    };
  }, [ledger, activeProfile]);

  return accounts;
}