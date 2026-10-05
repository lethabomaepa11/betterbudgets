"use client";

import { useEffect, useState } from "react";

import { useLocalDb } from "@/lib/local-db/provider";
import { DEFAULT_CURRENCY, SUPPORTED_CURRENCIES, currencyLabel, today } from "@/lib/local-db";
import { useVault } from "@/lib/local-db/vault";

import LocalDbStatus from "@/components/local-db-status";

/**
 * Profile name, display currency, data ownership, and the escape hatches.
 *
 * Only display preferences live here. The PIN and password are deliberately not
 * editable from settings — changing a credential has to go through the unlock
 * path that verifies the old one first, so no screen can overwrite it without
 * proving you knew what it was.
 */
export default function SettingsPage() {
  const { activeProfile, updateSettings, busy, error, clearError } = useVault();

  const [name, setName] = useState(activeProfile?.name ?? "");
  const [currency, setCurrency] = useState(activeProfile?.currency ?? DEFAULT_CURRENCY);
  const [saved, setSaved] = useState(false);
  const { db } = useLocalDb();

  const [exporting, setExporting] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [busyMessage, setBusyMessage] = useState<string | null>(null);

  // Keep the form in step with the profile when the vault re-reads it (after a
  // rename, or when a settings write round-trips), without clobbering in-flight
  // typing on every keystroke.
  useEffect(() => {
    if (activeProfile) setCurrency(activeProfile.currency);
  }, [activeProfile]);

  /**
   * Exports everything as a JSON file.
   *
   * The spec requires the user be able to get their data out, and with no server
   * involved this file *is* their backup. Built from the same read paths the
   * screens use, so it cannot drift from what is on screen.
   */
  async function exportData() {
    if (!db || !activeProfile) return;
    setExporting(true);
    setBusyMessage(null);
    try {
      const { createBudgets } = await import("@/lib/local-db/budgets");
      const { createCategories } = await import("@/lib/local-db/categories");
      const profileId = activeProfile.id;

      const [accounts, categories, activity, budgets] = await Promise.all([
        db.query("SELECT * FROM accounts WHERE deleted_at IS NULL", [profileId]),
        createCategories(db).list(profileId),
        db.query(
          `SELECT * FROM transactions WHERE deleted_at IS NULL ORDER BY occurred_on ASC`,
          [profileId],
        ),
        createBudgets(db).list(profileId),
      ]);

      const payload = {
        // Versioned so a future importer can tell an old file from a new one.
        format: "betterbudgets-export",
        version: 1,
        exportedAt: new Date().toISOString(),
        currency,
        accounts,
        categories,
        transactions: activity,
        budgets,
      };

      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `betterbudgets-${today()}.json`;
      anchor.click();
      // Revoking immediately can cancel the download in some browsers, so it is
      // deferred a tick rather than done inline.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) {
      setBusyMessage(
        cause instanceof Error ? cause.message : "Couldn't export your data.",
      );
    } finally {
      setExporting(false);
    }
  }

  async function resetEverything() {
    if (!db) return;
    setResetting(true);
    setBusyMessage(null);
    try {
      await db.reset();
      // A full reload is the only reliable way to get every screen back to
      // first-run state: the vault session, the ledger handle and every cached
      // list all point at rows that no longer exist.
      window.location.href = "/dashboard";
    } catch (cause) {
      setBusyMessage(
        cause instanceof Error ? cause.message : "Couldn't clear your data.",
      );
      setResetting(false);
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    clearError();
    const ok = await updateSettings({ name, currency });
    if (ok) setSaved(true);
  }

  if (!activeProfile) return null;

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          {name || "Your profile"}, stored on this device.
        </p>
      </header>

      <form onSubmit={submit} className="flex flex-col gap-5">
        <label className="block">
          <span className="text-sm font-medium">Your name</span>
          <input
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setSaved(false);
            }}
            autoComplete="name"
            className="mt-2 h-12 w-full rounded-2xl border border-input bg-transparent px-4 outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
          />
        </label>

        <label className="block">
          <span className="text-sm font-medium">Currency</span>
          <select
            value={currency}
            onChange={(event) => {
              setCurrency(event.target.value);
              setSaved(false);
            }}
            className="mt-2 h-12 w-full rounded-2xl border border-input bg-transparent px-4 outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            {SUPPORTED_CURRENCIES.map((code) => (
              <option key={code} value={code}>
                {currencyLabel(code)}
              </option>
            ))}
          </select>
          <span className="mt-1.5 block text-xs text-muted-foreground">
            How amounts are shown everywhere in the app. Your stored numbers
            don&apos;t change.
          </span>
        </label>

        {error && (
          <p role="alert" className="text-sm text-expense-strong">
            {error}
          </p>
        )}

        {saved && !error && (
          <p role="status" className="text-sm text-income-strong">
            Saved.
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="h-12 w-full rounded-2xl bg-primary text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save changes"}
        </button>
      </form>

      <section aria-label="Data" className="space-y-4">
        <h2 className="text-sm font-medium">Your data</h2>
        <p className="text-xs/relaxed text-muted-foreground">
          Everything lives in this browser. Nothing is uploaded, and nothing is
          readable by an account you don&apos;t own.
        </p>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void exportData()}
            disabled={exporting}
            className="h-10 rounded-full border border-input px-4 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-50"
          >
            {exporting ? "Preparing…" : "Export as JSON"}
          </button>
        </div>

        {/* Clear-all is the one action that can lose real work, so it is behind
            a deliberate two-step confirm that names exactly what goes. */}
        {confirmReset ? (
          <div className="space-y-3 rounded-2xl border border-destructive/40 bg-destructive/5 p-4">
            <p className="text-sm font-medium">Delete everything on this device?</p>
            <p className="text-xs/relaxed text-muted-foreground">
              Your accounts, categories, budgets and every transaction will be
              permanently removed. This cannot be undone — export first if you
              might want any of it back.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void resetEverything()}
                disabled={resetting}
                className="h-10 rounded-full bg-destructive/10 px-4 text-sm font-medium text-destructive transition-colors hover:bg-destructive/20 disabled:opacity-50"
              >
                {resetting ? "Deleting…" : "Yes, delete it all"}
              </button>
              <button
                type="button"
                onClick={() => setConfirmReset(false)}
                className="h-10 rounded-full px-4 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                Keep my data
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmReset(true)}
            className="text-sm text-muted-foreground underline-offset-4 transition-colors hover:text-expense-strong hover:underline"
          >
            Clear all local data
          </button>
        )}

        {busyMessage && (
          <p role="alert" className="text-sm text-expense-strong">
            {busyMessage}
          </p>
        )}
      </section>

      <section aria-label="Storage" className="rounded-3xl bg-card p-5 shadow-soft ring-1 ring-foreground/6">
        <h2 className="text-sm font-medium">Where your data lives</h2>
        <p className="mt-1.5 text-xs/relaxed text-muted-foreground">
          This profile is not a server account. Nothing here is uploaded, and
          clearing your browser&apos;s site data will remove it.
        </p>
        <LocalDbStatus className="mt-3" />
      </section>

      <section aria-label="Security" className="rounded-3xl bg-card p-5 shadow-soft ring-1 ring-foreground/6">
        <h2 className="text-sm font-medium">Signing in</h2>
        <p className="mt-1.5 text-xs/relaxed text-muted-foreground">
          You unlocked with a {activeProfile.credential_type === "pin" ? "PIN" : "password"}.
          Locking from the header ends the session; the database itself stays on
          this device.
        </p>
      </section>
    </div>
  );
}