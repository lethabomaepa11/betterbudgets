"use client";

// The unlock session.
//
// The one rule this file exists to enforce: `activeProfile` is plain React
// state. It is not written to localStorage, sessionStorage, cookies, IndexedDB
// or the database, so it exists only for as long as this component tree does.
// Close the tab, close the window, reload — and the next load starts at
// "locked", exactly like a banking app.
//
// Everything that *is* durable (the salt/verifier pair) lives in the SQLite
// database and is read-only to this module.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import type {
  BudgetFor,
  CredentialType,
  OnboardingStep,
  ProfileSummary,
} from "./schema";
import { createProfile, listProfiles, setOnboarding, unlockProfile, updateProfileSettings } from "./profiles";
import { LockoutError } from "./credentials";
import { useLocalDb } from "./provider";

type VaultStatus = "checking" | "onboard" | "locked" | "unlocked";

export type CreateProfileInput = {
  name: string;
  credentialType: CredentialType;
  secret: string;
};

type VaultValue = {
  status: VaultStatus;
  /** Profiles that exist on this device (never the credential material). */
  profiles: ProfileSummary[];
  /** Set only while `status === "unlocked"`; never persisted. */
  activeProfile: ProfileSummary | null;
  error: string | null;
  busy: boolean;
  createProfile: (input: CreateProfileInput) => Promise<boolean>;
  unlock: (profileId: string, secret: string) => Promise<boolean>;
  /** Drops the in-memory session. The database is untouched. */
  logout: () => void;
  /**
   * Announces that ledger data changed, so every screen showing totals or lists
   * re-reads. Call it after a successful write — not instead of one.
   */
  dataChanged: () => void;
  /** Renames the profile and/or changes its display currency. */
  updateSettings: (input: { name: string; currency: string }) => Promise<boolean>;
  /**
   * Moves the guided setup to `step`. Onboarding screens call this as they are
   * completed; the value is persisted so a closed tab resumes where it left off.
   */
  setOnboardingStep: (
    step: OnboardingStep,
    budgetFor?: BudgetFor | null,
  ) => Promise<boolean>;
  clearError: () => void;
};

const VaultContext = createContext<VaultValue | null>(null);

/** Human-readable countdown for a lockout. */
export function describeLockout(retryAfterMs: number): string {
  const seconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  return `Too many attempts. Try again in ${seconds} second${seconds === 1 ? "" : "s"}.`;
}

function messageOf(error: unknown): string {
  if (error instanceof LockoutError) return describeLockout(error.retryAfterMs);
  if (error instanceof Error) return error.message;
  return "Something went wrong.";
}

/**
 * A signal that the on-device data changed, and the id of the profile that
 * changed it.
 *
 * Ledger writes are awaited individually by the form that made them, so without
 * this a sibling screen (the home totals, the activity list) has no way to learn
 * something happened. Bumping the counter is what every reader watches; the
 * `profileId` is included so a profile switch re-reads even if the counter value
 * happens to coincide.
 */
type DataVersion = {
  profileId: string | null;
  nonce: number;
  /** Bumps the version so every data-reading screen re-reads. */
  bump: (profileId: string | null) => void;
};

const DataVersionContext = createContext<DataVersion>({
  profileId: null,
  nonce: 0,
  bump: () => undefined,
});

/**
 * Reloads when `dependency` changes, including when any write bumps the version.
 *
 * Returns a stable callback rather than the data, because every consumer does
 * the same shape of work (read, then set local state); duplicating that effect
 * across the screens is how they drift apart. Pass the things a first read needs
 * — the profile id, the account being viewed — and nothing else.
 */
export function useAutoRefresh(dependency: unknown): void {
  const { nonce } = useContext(DataVersionContext);
  useEffect(() => {
    // Reading `nonce` here is deliberate: it is the signal that a write landed,
    // and this hook's job is to re-run the caller's read effect when it moves.
    void nonce;
    void dependency;
  }, [dependency, nonce]);
}

export function VaultProvider({ children }: { children: React.ReactNode }) {
  const { db, status: dbStatus } = useLocalDb();

  // The session's copy of the profile, held by id and resolved against the list
  // below. Storing the id rather than the object is what lets a settings edit
  // (new name, new currency) reach the session through an ordinary list re-read.
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  // Pair the profile list with the handle it was read from. Reads against the
  // provider's `db` directly would hit whatever handle replaced it mid-flight;
  // `boot` keeps each cycle's reads and writes pointed at its own handle.
  const [boot, setBoot] = useState<{ handle: typeof db; rows: ProfileSummary[] }>({
    handle: null,
    rows: [],
  });
  // Mirrors `boot.rows` without forcing callbacks to re-create when the same
  // rows are re-read. Unlock is the consumer: an `unlock` call must read the
  // profile list that rendered the lock screen even if a parent re-rendered
  // after the user started typing.
  const bootRowsRef = useRef<ProfileSummary[]>(boot.rows);
  bootRowsRef.current = boot.rows;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Ledger-data invalidation counter. Separate from `boot`, which only tracks
  // the profile list, because editing a transaction must not re-read profiles.
  const [versionNonce, setVersionNonce] = useState(0);

  // Re-read the profile list whenever the underlying database becomes
  // available. Guarded by comparing handles so StrictMode's double effect and
  // provider retries do not run it twice against the same handle.
  useEffect(() => {
    if (dbStatus !== "ready" || !db || boot.handle === db) return;
    let cancelled = false;
    void listProfiles(db)
      .then((rows) => {
        if (cancelled) return;
        setBoot({ handle: db, rows });
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(messageOf(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [db, dbStatus, boot.handle]);

  const refresh = useCallback(async () => {
    if (!db || dbStatus !== "ready") return;
    const rows = await listProfiles(db);
    setBoot({ handle: db, rows });
  }, [db, dbStatus]);

  const activeProfile = useMemo(
    () => boot.rows.find((row) => row.id === activeProfileId) ?? null,
    [boot.rows, activeProfileId],
  );

  // Any write that changes ledger data announces itself here, so the screens
  // showing totals and lists re-read instead of rendering numbers that are now
  // stale. The write itself is awaited by the caller; this only notifies.
  const bumpDataVersion = useCallback((profileId: string | null) => {
    setVersionNonce((current) => current + 1);
    void profileId;
  }, []);

  const dataVersion = useMemo<DataVersion>(
    () => ({ profileId: activeProfileId, nonce: versionNonce, bump: bumpDataVersion }),
    [activeProfileId, versionNonce, bumpDataVersion],
  );

  const create = useCallback(
    async (input: CreateProfileInput) => {
      if (!db || dbStatus !== "ready") return false;
      setBusy(true);
      setError(null);
      try {
        const created = await createProfile(db, input);
        setActiveProfileId(created.id);
        await refresh();
        return true;
      } catch (cause) {
        setError(messageOf(cause));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [db, dbStatus, refresh],
  );

  const unlock = useCallback(
    async (profileId: string, secret: string) => {
      if (!db || dbStatus !== "ready") return false;
      setBusy(true);
      setError(null);
      try {
        await unlockProfile(db, profileId, secret);

        // Re-read against the same handle so the returned summary carries the
        // cleared failure counter. The fallback survives the row vanishing
        // between reads.
        const rows = await listProfiles(db);
        const fresh = rows.find((row) => row.id === profileId);
        if (fresh ?? bootRowsRef.current.find((row) => row.id === profileId)) {
          setActiveProfileId(profileId);
        }
        await refresh();
        return true;
      } catch (cause) {
        setError(messageOf(cause));
        // Re-read against the same handle so a lockout that just began disables
        // the form instead of silently leaving it enabled.
        await refresh().catch(() => undefined);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [db, dbStatus, refresh],
  );

  const logout = useCallback(() => {
    // Deliberately synchronous: logout must take effect before any other work
    // so nothing can render from a session that was just dropped.
    setActiveProfileId(null);
    setError(null);
    setBoot({ handle: null, rows: [] });
  }, []);

  const dataChanged = useCallback(() => {
    bumpDataVersion(activeProfileId);
  }, [bumpDataVersion, activeProfileId]);

  const updateSettings = useCallback(
    async (input: { name: string; currency: string }) => {
      if (!db || dbStatus !== "ready" || !activeProfileId) return false;
      setBusy(true);
      setError(null);
      try {
        await updateProfileSettings(db, activeProfileId, input);
        // Re-read so the session's copy carries the new name and currency; the
        // profile is stored by id precisely so this edit can flow back through it.
        await refresh();
        return true;
      } catch (cause) {
        setError(messageOf(cause));
        return false;
      } finally {
        setBusy(false);
      }
    },
[db, dbStatus, activeProfileId, refresh],
  );

  /**
   * Moves the guided setup forward.
   *
   * One call rather than one per step, so each screen can advance itself without
   * knowing what comes next, and so "resume where I left off" needs no special
   * casing — reopening the app simply reads whatever this last wrote.
   */
  const setOnboardingStep = useCallback(
    async (step: OnboardingStep, budgetFor: BudgetFor | null = null) => {
      if (!db || dbStatus !== "ready" || !activeProfileId) return false;
      setBusy(true);
      setError(null);
      try {
        await setOnboarding(db, activeProfileId, step, budgetFor);
        // Re-read so the session's copy carries the new step. Onboarding screens
        // read `activeProfile.onboarding_step` to decide what to show next.
        await refresh();
        return true;
      } catch (cause) {
        setError(messageOf(cause));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [db, dbStatus, activeProfileId, refresh],
  );

  const value = useMemo<VaultValue>(() => {
    const profiles = boot.rows;
    let status: VaultStatus = "checking";
    if (dbStatus !== "ready") status = "checking";
    else if (activeProfile) status = "unlocked";
    else if (boot.handle && profiles.length === 0) status = "onboard";
    else if (boot.handle) status = "locked";

    return {
      status,
      profiles,
      activeProfile,
      error,
      busy,
      createProfile: create,
      unlock,
      logout,
      dataChanged,
      updateSettings,
      setOnboardingStep,
      clearError: () => setError(null),
    };
    // `boot.rows` is read through `boot` to keep the dependency list stable;
    // `bootRowsRef` is intentionally excluded from it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    dbStatus,
    activeProfile,
    boot,
    error,
    busy,
    create,
    unlock,
    logout,
    dataChanged,
    updateSettings,
    setOnboardingStep,
  ]);

  return (
    <VaultContext.Provider value={value}>
      <DataVersionContext.Provider value={dataVersion}>{children}</DataVersionContext.Provider>
    </VaultContext.Provider>
  );
}

export function useVault(): VaultValue {
  const context = useContext(VaultContext);
  if (!context) throw new Error("useVault must be used inside <VaultProvider>.");
  return context;
}
