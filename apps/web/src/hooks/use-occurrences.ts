/**
 * Money that is expected but not yet settled, refreshed on every write.
 *
 * This is what the dashboard's "needs you" panel renders, so it re-reads on the
 * same signal as the rest of the app: confirming a payment anywhere has to move
 * it off the list immediately, not on the next page load.
 */
"use client";

import { useEffect, useState } from "react";

import { listUpcoming, syncAllRules, today, type OccurrenceRow } from "@/lib/local-db";
import { useLocalDb } from "@/lib/local-db/provider";
import { useAutoRefresh, useVault } from "@/lib/local-db/vault";

export function useOccurrences() {
  const { db } = useLocalDb();
  const { activeProfile } = useVault();
  const [rows, setRows] = useState<OccurrenceRow[]>([]);
  const [loading, setLoading] = useState(true);

  const refreshVersion = useAutoRefresh(`${activeProfile?.id}:occurrences`);

  useEffect(() => {
    if (!db || !activeProfile) return;
    let cancelled = false;

    // Tops the occurrence window up before reading, so a series created weeks ago
    // still shows what is coming. Idempotent, so it costs one query per rule and
    // inserts nothing that already exists.
    void syncAllRules(db, activeProfile.id)
      .then(() => listUpcoming(db, activeProfile.id, today()))
      .then((result) => {
        if (cancelled) return;
        setRows(result);
        setLoading(false);
      })
      .catch(() => {
        // A failed read leaves the panel empty rather than wrong; the dashboard
        // has an empty state for it.
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [db, activeProfile, refreshVersion]);

  return { rows, loading };
}