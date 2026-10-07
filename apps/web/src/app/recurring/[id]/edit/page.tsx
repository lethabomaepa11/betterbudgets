"use client";

import { useEffect, useState } from "react";

import type { Route } from "next";
import { useParams, useRouter } from "next/navigation";

import RecurringForm, {
  type RecurringDraft,
  type RecurringValues,
} from "@/components/recurring-form";
import { listRules, updateRule, type RuleRow } from "@/lib/local-db";
import { useLocalDb } from "@/lib/local-db/provider";
import { useAutoRefresh, useVault } from "@/lib/local-db/vault";

/**
 * Edit one recurring rule.
 *
 * The route carries the id rather than the rule itself so a refresh, a back
 * button and a second tab all land on the same series — putting the rule in
 * state instead would open a stale copy after any of them.
 */
export default function EditRecurringPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { db } = useLocalDb();
  const { activeProfile } = useVault();

  const [rule, setRule] = useState<RuleRow | null>(null);
  const [missing, setMissing] = useState(false);

  const refreshVersion = useAutoRefresh(`${activeProfile?.id}:rules`);

  useEffect(() => {
    if (!db || !activeProfile) return;
    let cancelled = false;

    void listRules(db, activeProfile.id)
      .then((rows) => {
        if (cancelled) return;
        const found = rows.find((row) => row.id === id) ?? null;
        setRule(found);
        if (!found) setMissing(true);
      })
      .catch(() => setMissing(true));

    return () => {
      cancelled = true;
    };
  }, [db, activeProfile, id, refreshVersion]);

  async function submit(values: RecurringValues) {
    if (!db || !activeProfile) return;

    await updateRule(
      db,
      activeProfile.id,
      id,
      {
        name: values.name,
        amount: values.amount,
        accountId: values.accountId,
        categoryId: values.categoryId,
        frequency: values.frequency,
        anchor: values.anchor,
        startsOn: values.startsOn,
        endsOn: values.endsOn,
      },
      values.scope,
    );
    router.push("/recurring");
  }

  if (missing) {
    return (
      <div className="mx-auto w-full max-w-md space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">Edit this one</h1>
        <p className="text-sm text-muted-foreground">
          That repeating item has been removed, so there is nothing left to edit.
        </p>
        <button
          type="button"
          onClick={() => router.push("/recurring" as Route)}
          className="inline-flex h-11 items-center rounded-2xl bg-primary px-5 text-sm font-medium text-primary-foreground"
        >
          Back to repeating money
        </button>
      </div>
    );
  }

  if (!rule) return null;

  const draft: RecurringDraft = {
    name: rule.name ?? "",
    amount: rule.amount ?? 0,
    accountId: rule.accountId ?? "",
    sourceAccountId: rule.sourceAccountId,
    categoryId: rule.categoryId,
    type: rule.type ?? "outflow",
    frequency: rule.frequency,
    anchor: rule.anchor,
    startsOn: rule.nextDueDate,
    endsOn: rule.endDate,
  };

  return <RecurringForm initial={draft} editing onSubmit={submit} />;
}