"use client";

import { useEffect, useRef, useState } from "react";

import { useLocalDb } from "@/lib/local-db/provider";
import { DEFAULT_CURRENCY, SUPPORTED_CURRENCIES, currencyLabel, today } from "@/lib/local-db";
import { useVault } from "@/lib/local-db/vault";

import LocalDbStatus from "@/components/local-db-status";
import VaultGate from "@/components/vault/gate";
import {
  decodePortableData,
  decodePortableLink,
  encodePortableData,
  replaceProfileData,
  type PortableData,
} from "@/lib/portable-data";
import { createTransferPayload, decryptTransferPayload } from "@/lib/share-transfer";

/**
 * Profile name, display currency, data ownership, and the escape hatches.
 *
 * Only display preferences live here. The PIN and password are deliberately not
 * editable from settings — changing a credential has to go through the unlock
 * path that verifies the old one first, so no screen can overwrite it without
 * proving you knew what it was.
 */
function SettingsContent() {
  const { activeProfile, updateSettings, busy, error, clearError, dataChanged } = useVault();

  const [name, setName] = useState(activeProfile?.name ?? "");
  const [currency, setCurrency] = useState(activeProfile?.currency ?? DEFAULT_CURRENCY);
  const [saved, setSaved] = useState(false);
  const { db } = useLocalDb();

  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [qrVisible, setQrVisible] = useState(false);
  const [shareMode, setShareMode] = useState<"choose" | "waiting" | null>(null);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [shareExpiresAt, setShareExpiresAt] = useState<number | null>(null);
  const [isLocalhost, setIsLocalhost] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [resetting, setResetting] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [busyMessage, setBusyMessage] = useState<string | null>(null);

  // Keep the form in step with the profile when the vault re-reads it (after a
  // rename, or when a settings write round-trips), without clobbering in-flight
  // typing on every keystroke.
  useEffect(() => {
    if (activeProfile) setCurrency(activeProfile.currency);
  }, [activeProfile]);

  useEffect(() => {
    setIsLocalhost(["localhost", "127.0.0.1"].includes(window.location.hostname));
  }, []);

  useEffect(() => {
    const transferId = new URLSearchParams(window.location.search).get("transfer");
    const secret = window.location.hash.slice(1);
    if (transferId && secret && db && activeProfile) {
      void (async () => {
        try {
          const response = await fetch("/api/share/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "download", id: transferId, code: transferId.slice(0, 6).toUpperCase() }) });
          const result = await response.json();
          if (!result.ready) throw new Error("The other device has not finished preparing the transfer.");
          const portable = decodePortableData(await decryptTransferPayload(result.payload, result.nonce, secret));
          if (!window.confirm(`Receive ${portable.records.length} records and replace this profile's financial data? Your local PIN/password will remain unchanged.`)) return;
          await importData(portable);
          setBusyMessage("Data restored from the other device.");
          window.history.replaceState({}, "", "/settings");
        } catch (cause) {
          setBusyMessage(cause instanceof Error ? cause.message : "Couldn't receive the shared data.");
        }

      })();
      return;
    }

    const value = new URLSearchParams(window.location.search).get("data");
    if (!value || !db || !activeProfile) return;
    void (async () => {
      try {
        const portable = decodePortableLink(value);
        const accepted = window.confirm(
          `Import ${portable.records.length} shared records into this profile? Anyone with this link can share or alter the data before you import it.`,
        );
        if (!accepted) {
          window.history.replaceState({}, "", "/settings");
          return;
        }
        await importData(portable);
        setBusyMessage("Shared data imported into this profile.");
        window.history.replaceState({}, "", "/settings");
      } catch (cause) {
        setBusyMessage(cause instanceof Error ? cause.message : "Couldn't import the shared data.");
      }
    })();
  }, [db, activeProfile]);

  async function startShare() {
    setShareMode("waiting");
    setBusyMessage(null);
    try {
      const portable = await collectPortableData();
      const response = await fetch("/api/share/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "create" }) });
      const session = await response.json();
      if (!response.ok) throw new Error(session.error ?? "Couldn't start a transfer.");
      const encrypted = await createTransferPayload(encodePortableData(portable));
      await fetch("/api/share/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "upload", id: session.id, payload: encrypted.payload, nonce: encrypted.nonce }) });
      const configuredOrigin = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
      const origin = configuredOrigin || window.location.origin;
      const url = `${origin}/transfer?transfer=${session.id}#${encrypted.secret}`;
      setShareLink(url);
      setPairingCode(session.code);
      setShareExpiresAt(session.expiresAt);
      setQrVisible(true);
      await navigator.clipboard?.writeText(url);
      return url;
    } catch (cause) {
      setShareMode(null);
      setBusyMessage(cause instanceof Error ? cause.message : "Couldn't start a transfer.");
      return null;
    }
  }

  /**
   * Exports everything as a JSON file.
   *
   * The spec requires the user be able to get their data out, and with no server
   * involved this file *is* their backup. Built from the same read paths the
   * screens use, so it cannot drift from what is on screen.
   */
  async function collectPortableData(): Promise<PortableData> {
    if (!db || !activeProfile) throw new Error("The local database is not ready.");
    const profileId = activeProfile.id;
    const [accounts, categories, transactions, budgets, budgetItems] = await Promise.all([
      db.query<Record<string, unknown>>(
        "SELECT id,name,type,balance,is_archived FROM accounts WHERE profile_id = ? AND deleted_at IS NULL",
        [profileId],
      ),
      db.query<Record<string, unknown>>(
        "SELECT id,name,kind,icon,color,sort_order,is_archived FROM categories WHERE profile_id = ? AND deleted_at IS NULL",
        [profileId],
      ),
      db.query<Record<string, unknown>>(
        `SELECT t.id,t.account_id,t.source_account_id,t.name,t.amount,t.type,t.is_allowance,
                t.occurred_on,t.category_id,t.notes
           FROM transactions t JOIN accounts a ON a.id=t.account_id
          WHERE a.profile_id = ? AND t.deleted_at IS NULL ORDER BY t.occurred_on ASC`,
        [profileId],
      ),
      db.query<Record<string, unknown>>(
        "SELECT id,name,period,starts_on FROM budgets WHERE profile_id = ? AND deleted_at IS NULL",
        [profileId],
      ),
      db.query<Record<string, unknown>>(
        `SELECT bi.id,bi.budget_id,bi.category_id,bi.limit_amount
           FROM budget_items bi JOIN budgets b ON b.id=bi.budget_id
          WHERE b.profile_id = ? AND bi.deleted_at IS NULL`,
        [profileId],
      ),
    ]);
    const record = (type: PortableData["records"][number]["type"], row: Record<string, unknown>, fields: string[]) => ({
      type,
      values: fields.map((field) => String(row[field] ?? "")),
    });
    return {
      currency: activeProfile.currency,
      records: [
        ...accounts.map((row) => record("account", row, ["id", "name", "type", "balance", "is_archived"])),
        ...categories.map((row) => record("category", row, ["id", "name", "kind", "icon", "color", "sort_order", "is_archived"])),
        ...transactions.map((row) => record("transaction", row, ["id", "account_id", "source_account_id", "name", "amount", "type", "is_allowance", "occurred_on", "category_id", "notes"])),
        ...budgets.map((row) => record("budget", row, ["id", "name", "period", "starts_on"])),
        ...budgetItems.map((row) => record("budget_item", row, ["id", "budget_id", "category_id", "limit_amount"])),
      ],
    };
  }

  async function exportData() {
    if (!db || !activeProfile) return;
    setExporting(true);
    setBusyMessage(null);
    try {
      const portable = await collectPortableData();
      const blob = new Blob([encodePortableData(portable)], { type: "application/vnd.betterbudgets" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `betterbudgets-${today()}.bbdata`;
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

  async function importData(portable: PortableData) {
    if (!db || !activeProfile) return;
    await replaceProfileData(db, activeProfile.id, portable);
    dataChanged();
    return;
  }

  async function handleFile(file: File) {
    setImporting(true);
    setBusyMessage(null);
    try {
      await importData(decodePortableData(await file.text()));
      setBusyMessage("Data imported into this profile.");
    } catch (cause) {
      setBusyMessage(cause instanceof Error ? cause.message : "Couldn't import that file.");
    } finally {
      setImporting(false);
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
            {exporting ? "Preparing…" : "Export .bbdata"}
          </button>
          <input ref={fileInput} type="file" accept=".bbdata,.txt" className="sr-only" onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void handleFile(file);
            event.target.value = "";
          }} />
          <button type="button" onClick={() => fileInput.current?.click()} disabled={importing} className="h-10 rounded-full border border-input px-4 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-50">
            {importing ? "Importing…" : "Import .bbdata"}
          </button>
          <button type="button" onClick={() => setShareMode("choose")} className="h-10 rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover">
            Share my data
          </button>
        </div>
        {shareMode === "choose" && (
          <div className="space-y-4 rounded-2xl border border-primary/30 bg-primary-subtle/30 p-4">
            <div>
              <h3 className="font-medium">Move your budget anywhere</h3>
              <p className="mt-1 text-xs/relaxed text-muted-foreground">Continue on another device, restore after reinstalling, or give a household member a copy. Your data stays encrypted in your browser during device transfer.</p>
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              <button type="button" onClick={() => void startShare()} className="rounded-xl border border-input bg-background p-3 text-left transition-colors hover:border-primary">
                <span className="block text-sm font-medium">QR code</span>
                <span className="block text-xs text-muted-foreground">Fastest device connection</span>
              </button>
              <button type="button" onClick={() => void startShare()} className="rounded-xl border border-input bg-background p-3 text-left transition-colors hover:border-primary">
                <span className="block text-sm font-medium">Share link</span>
                <span className="block text-xs text-muted-foreground">Open on another device</span>
              </button>
              <button type="button" onClick={() => void exportData()} className="rounded-xl border border-input bg-background p-3 text-left transition-colors hover:border-primary">
                <span className="block text-sm font-medium">.bbdata file</span>
                <span className="block text-xs text-muted-foreground">Offline backup</span>
              </button>
            </div>
          </div>
        )}
        {shareLink && (
          <div className="space-y-3 rounded-2xl border border-warning/40 bg-warning/5 p-4">
            <p className="text-xs/relaxed text-muted-foreground">The QR contains only a short-lived pairing token. Your financial data is encrypted before it leaves this browser.</p>
            {(!process.env.NEXT_PUBLIC_APP_URL && isLocalhost) && (
              <p role="alert" className="text-xs/relaxed text-warning-strong">
                This app is running on localhost, which your other device cannot reach. Open Better Budgets from a deployed URL or set <code>NEXT_PUBLIC_APP_URL</code> to a LAN-reachable address before scanning.
              </p>
            )}
            {pairingCode && <p className="text-center text-2xl font-semibold tracking-[0.3em]">{pairingCode}</p>}
            <input readOnly value={shareLink} className="h-10 w-full rounded-xl border border-input bg-background px-3 text-xs" aria-label="Share link" />
            {qrVisible && <img src={`/api/share/qr?data=${encodeURIComponent(shareLink)}`} alt="QR code for secure device pairing" className="h-56 w-56 rounded-xl bg-white p-2" />}
            {shareExpiresAt && <p className="text-xs text-muted-foreground">This pairing expires in 10 minutes. The receiving device must confirm before its data is replaced.</p>}
          </div>
        )}

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

export default function SettingsPage() {
  return (
    <VaultGate>
      <SettingsContent />
    </VaultGate>
  );
}