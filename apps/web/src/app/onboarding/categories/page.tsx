"use client";

import { useEffect, useRef, useState } from "react";

import type { Route } from "next";
import { Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";

import {
  SUGGESTED_CATEGORIES,
  createCategories,
  seedSuggestedCategories,
  type CategoryKind,
  type LocalDbHandle,
} from "@/lib/local-db";
import { useLocalDb } from "@/lib/local-db/provider";
import { STEP_COPY } from "@/lib/onboarding-steps";
import { useVault } from "@/lib/local-db/vault";

import { useCategories } from "@/hooks/use-categories";

type Draft = { key: string; name: string; kind: CategoryKind };

/**
 * Step 4 — categories.
 *
 * The suggested set is a toggling list rather than a form to fill in. The spec
 * asks that a user can keep, remove, rename or add, and a checklist makes
 * "remove three of these" a two-tap job where a form makes it a typing exercise.
 *
 * Nothing is written until Continue, so backing out leaves no half-configured
 * vocabulary behind.
 */
/**
 * Makes the stored categories match the names the user kept.
 *
 * Seed-then-reconcile rather than a bespoke "create exactly these" call, because
 * the seed is already a single batch and this only has to handle the difference.
 * Matching is case-insensitive on purpose: someone typing "groceries" for an
 * existing "Groceries" means the same category, not a duplicate one.
 */
async function reconcileCategories(
  db: LocalDbHandle,
  profileId: string,
  wantedNames: readonly string[],
): Promise<void> {
  const { list, archiveCategory, createCategory } = createCategories(db);
  const stored = await list(profileId);

  const wanted = new Set(wantedNames.map((name) => name.toLowerCase()));

  for (const category of stored) {
    if (!wanted.has(category.name.toLowerCase())) {
      // Archive rather than delete: the FK is ON DELETE SET NULL, so a category
      // the user removed here still can't take transactions with it.
      await archiveCategory(profileId, category.id);
    }
  }

  const kept = new Set(stored.map((category) => category.name.toLowerCase()));
  for (const name of wantedNames) {
    if (kept.has(name.toLowerCase())) continue;
    await createCategory(profileId, {
      name,
      kind: "expense",
    });
  }
}

export default function OnboardingCategoriesPage() {
  const router = useRouter();
  const { db } = useLocalDb();
  const { activeProfile, setOnboardingStep, busy } = useVault();
  const existing = useCategories();

  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Seeded from what is already stored, falling back to the suggestions.
  //
  // Re-seeds only on the empty -> populated transition. Keying this on
  // `existing` alone would be wrong: every read produces a new array, so any
  // background write would reset the checklist and discard names mid-edit.
  const seededFrom = useRef<"empty" | "populated" | null>(null);

  useEffect(() => {
    if (existing.length > 0) {
      if (seededFrom.current === "populated") return;
      seededFrom.current = "populated";
      setDrafts(
        existing.map((category) => ({
          key: category.id,
          name: category.name,
          kind: category.kind,
        })),
      );
      return;
    }

    // Before categories load, and when there are genuinely none, offer the
    // suggestions. Without this a returning user would meet an empty checklist
    // and have to retype everything.
    if (seededFrom.current === "empty") return;
    seededFrom.current = "empty";
    setDrafts(
      SUGGESTED_CATEGORIES.map((suggestion, index) => ({
        key: `${suggestion.kind}-${index}`,
        name: suggestion.name,
        kind: suggestion.kind,
      })),
    );
  }, [existing]);

  function rename(key: string, name: string) {
    setDrafts((current) =>
      current.map((draft) => (draft.key === key ? { ...draft, name } : draft)),
    );
  }

  function remove(key: string) {
    setDrafts((current) => current.filter((draft) => draft.key !== key));
  }

  function add() {
    const name = newName.trim();
    if (!name) return;
    setDrafts((current) => [
      ...current,
      // The key only has to be unique within this draft list; the real id is
      // generated on save.
      { key: `custom-${current.length}-${name}`, name, kind: "expense" },
    ]);
    setNewName("");
  }

  async function save() {
    if (!db || !activeProfile) return;

    // Blank names are dropped rather than rejected: a user who cleared a field
    // meant "don't include this", not "this is an error".
    const wanted = drafts.map((draft) => draft.name.trim()).filter(Boolean);
    if (wanted.length === 0) {
      setError("Keep at least one category, or skip this step.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      // Seed the common set in one batch, then reconcile against what the user
      // actually kept. Both are a single round-trip each, so the whole step stays
      // instant even on a slow connection.
      await seedSuggestedCategories(db, activeProfile.id);
      await reconcileCategories(db, activeProfile.id, wanted);
      await setOnboardingStep("budget");
      router.push("/onboarding/budget" as Route);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't save your categories.");
      setSaving(false);
    }
  }

  async function skip() {
    setSaving(true);
    await setOnboardingStep("budget");
    router.push("/onboarding/budget" as Route);
  }

  const income = drafts.filter((draft) => draft.kind === "income");
  const expense = drafts.filter((draft) => draft.kind === "expense");

  return (
    <div className="flex flex-col gap-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">{STEP_COPY.categories.title}</h1>
        <p className="text-sm/relaxed text-muted-foreground">{STEP_COPY.categories.body}</p>
      </header>

      <CategoryGroup title="Money in" drafts={income} onRename={rename} onRemove={remove} />
      <CategoryGroup title="Money out" drafts={expense} onRename={rename} onRemove={remove} />

      <section className="space-y-3">
        <h2 className="text-sm font-medium">Add your own</h2>
        <div className="flex gap-2">
          <input
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            placeholder="e.g. Pets"
            aria-label="New category name"
            className="h-12 min-w-0 flex-1 rounded-2xl border border-input bg-transparent px-4 outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
          />
          <button
            type="button"
            onClick={add}
            disabled={!newName.trim()}
            aria-label="Add category"
            className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground transition-opacity disabled:opacity-40"
          >
            <Plus className="size-5" aria-hidden="true" />
          </button>
        </div>
      </section>

      {error && (
        <p role="alert" className="text-sm text-expense-strong">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={() => void save()}
        disabled={saving || busy}
        className="h-14 w-full rounded-2xl bg-primary text-base font-medium text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-50"
      >
        {saving ? "Saving…" : "Continue"}
      </button>

      <button
        type="button"
        onClick={() => void skip()}
        disabled={saving || busy}
        className="-mt-4 h-11 w-full text-sm text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
      >
        Skip for now
      </button>
    </div>
  );
}

function CategoryGroup({
  title,
  drafts,
  onRename,
  onRemove,
}: {
  title: string;
  drafts: Draft[];
  onRename: (key: string, name: string) => void;
  onRemove: (key: string) => void;
}) {
  if (drafts.length === 0) return null;

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium">{title}</h2>
      <ul className="flex flex-col gap-1.5">
        {drafts.map((draft) => (
          <li key={draft.key} className="flex items-center gap-2">
            <input
              value={draft.name}
              onChange={(event) => onRename(draft.key, event.target.value)}
              aria-label={`${title} category`}
              className="h-11 min-w-0 flex-1 rounded-2xl border border-input bg-transparent px-3.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
            />
            <button
              type="button"
              onClick={() => onRemove(draft.key)}
              aria-label={`Remove ${draft.name}`}
              className="flex size-11 shrink-0 items-center justify-center rounded-2xl text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-expense-strong"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}