"use client";

import { useEffect, useState } from "react";

import { createCategories, type Category, type CategoryKind } from "@/lib/local-db";
import { useLocalDb } from "@/lib/local-db/provider";
import { useAutoRefresh, useVault } from "@/lib/local-db/vault";

/** A category row plus its group's name, as `createCategories.list` returns it. */
export type CategoryRow = Category & { group_name: string | null };

/**
 * Live categories, re-read whenever the vault reports a write.
 *
 * `kind` narrows to one direction, which is what the transaction form wants:
 * offering "Salary" while recording an expense is the kind of small wrongness
 * that makes a budgeting app feel unreliable.
 */
export function useCategories(kind?: CategoryKind): CategoryRow[] {
  // `db` rather than `ledger`: the category repository takes the raw handle,
  // and `ledger` is only the account/transaction facade over it.
  const { db } = useLocalDb();
  const { activeProfile } = useVault();
  const [rows, setRows] = useState<CategoryRow[]>([]);

  useAutoRefresh(`${activeProfile?.id}:${kind ?? "all"}`);

  useEffect(() => {
    if (!db || !activeProfile) return;
    let cancelled = false;

    const { list, listByKind } = createCategories(db);

    void (kind ? listByKind(activeProfile.id, kind) : list(activeProfile.id))
      .then((result) => {
        if (!cancelled) setRows(result);
      })
      .catch(() => {
        /* Each screen has an empty state; a failed read should not crash it. */
      });

    return () => {
      cancelled = true;
    };
  }, [db, activeProfile, kind]);

  return rows;
}