"use client";

import { useEffect, useState } from "react";

import { Button } from "@betterbudgets/ui/components/button";
import { cn } from "@betterbudgets/ui/lib/utils";
import { LockKeyhole, ShieldAlert } from "lucide-react";

import { remainingLockoutMs } from "@/lib/local-db/credentials";
import { useVault } from "@/lib/local-db/vault";

import CredentialEntry from "./credential-entry";

/** Re-renders on an interval while `active`, so a lockout counts down. */
function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

/**
 * The lock screen: a local profile exists but the tab has not been unlocked.
 *
 * This is the state you land in after closing the tab, which is why nothing on
 * this screen can be skipped — there is no "continue as guest" escape hatch,
 * because there is no session to continue.
 */
export default function VaultLock() {
  const { profiles, unlock, busy, error, clearError } = useVault();

  const [selectedId, setSelectedId] = useState(() => profiles[0]?.id ?? "");
  const selected = profiles.find((profile) => profile.id === selectedId) ?? profiles[0];
  const [secret, setSecret] = useState("");

  const now = useNow(true);
  const remaining = remainingLockoutMs(selected?.locked_until ?? null, now);
  const locked = remaining > 0;

  function submit(value: string) {
    if (!selected || locked || !value) return;
    clearError();
    void unlock(selected.id, value);
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center text-center">
      <div className="w-full rounded-3xl bg-card p-6 shadow-card ring-1 ring-foreground/6 sm:p-8">
        <span className="mx-auto flex size-14 items-center justify-center rounded-3xl bg-primary-subtle text-primary">
          <LockKeyhole className="size-6" aria-hidden="true" />
        </span>

        <h1 className="mt-4 text-2xl font-semibold tracking-tight">
          {selected ? `Welcome back, ${selected.name}` : "Unlock your budget"}
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Your budget is locked. {selected?.credential_type === "pin" ? "Enter your PIN." : "Enter your password."}
        </p>

        {profiles.length > 1 && (
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {profiles.map((profile) => (
              <button
                key={profile.id}
                type="button"
                onClick={() => {
                  clearError();
                  setSecret("");
                  setSelectedId(profile.id);
                }}
                className={cn(
                  "rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors",
                  profile.id === selected?.id
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary text-secondary-foreground hover:bg-accent",
                )}
              >
                {profile.name}
              </button>
            ))}
          </div>
        )}

        <div className="mt-6">
          {selected && (
            <CredentialEntry
              credentialType={selected.credential_type}
              value={secret}
              onChange={setSecret}
              onSubmit={submit}
              disabled={busy || locked}
            />
          )}
        </div>

        {locked ? (
          <p role="alert" className="mt-5 flex items-center justify-center gap-2 text-sm text-warning-strong">
            <ShieldAlert className="size-4 shrink-0" aria-hidden="true" />
            Locked. Try again in {remaining}s
          </p>
        ) : (
          <p role="alert" aria-live="polite" className="mt-5 min-h-5 text-sm text-expense-strong">
            {error}
          </p>
        )}
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        Nothing here is sent anywhere. Closing this tab locks it again.
      </p>
    </div>
  );
}
