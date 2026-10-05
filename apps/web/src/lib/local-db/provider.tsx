"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { LocalDb } from "./client";
import type { WorkerStorage } from "./protocol";
import { createLedger, type Ledger } from "./repositories";

/**
 * While the worker is booting or wedged, `ready()` gives no answer; this is
 * the ceiling after which silence is treated as a failure the user can see.
 *
 * It must sit above the worker's own sequential ceilings — 15s to load the
 * engine plus up to 12s to open OPFS — otherwise the provider can declare
 * failure while the worker is still mid-boot and would have recovered on its
 * in-memory fallback. A healthy boot finishes in well under a second.
 */
const WORKER_BOOT_TIMEOUT_MS = 30_000;

type LocalDbContextValue = {
  status: "opening" | "ready" | "unavailable";
  storage: WorkerStorage | null;
  reason: string | null;
  db: LocalDb | null;
  ledger: Ledger | null;
  /** Tears the current handle down and boots a fresh worker. */
  retry: () => void;
};

const LocalDbContext = createContext<LocalDbContextValue>({
  status: "opening",
  storage: null,
  reason: null,
  db: null,
  ledger: null,
  retry: () => undefined,
});

/**
 * Opens the on-device database once per page load and shares it with the tree.
 *
 * The worker is only ever created inside an effect: OPFS does not exist during
 * server rendering, and creating a `Worker` at module scope would break the
 * prerender of every page that happens to import this module.
 */
export function LocalDbProvider({ children }: { children: React.ReactNode }) {
  const [db, setDb] = useState<LocalDb | null>(null);
  const [constructionError, setConstructionError] = useState<string | null>(
    null,
  );
  const [opened, setOpened] = useState<{
    storage: WorkerStorage;
    reason: string | null;
  } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  // Bumping this runs the whole effect again: the old handle is disposed and a
  // fresh worker boots. This is what the "Retry" button drives.
  const [resetKey, setResetKey] = useState(0);

  const retry = useCallback(() => setResetKey((key) => key + 1), []);

  useEffect(() => {
    setDb(null);
    setConstructionError(null);
    setOpened(null);
    setFailed(null);

    let instance: LocalDb;
    try {
      instance = new LocalDb();
    } catch (cause) {
      // A synchronously-throwing constructor (CSP without worker-src, tiny old
      // browsers) previously left this hook in "opening" forever.
      setConstructionError(
        cause instanceof Error ? cause.message : String(cause),
      );
      return undefined;
    }

    let cancelled = false;
    let bootTimer: ReturnType<typeof setTimeout> | undefined;

    setDb(instance);

    const finishBoot = () => {
      if (bootTimer !== undefined) {
        clearTimeout(bootTimer);
        bootTimer = undefined;
      }
    };

    void instance.ready().then((state) => {
      // The previous cycle's promise can settle after this cycle started
      // (disposing a worker resolves its state). `cancelled` is what stops the
      // old worker from overwriting the new one's state.
      if (cancelled) return;
      finishBoot();

      if (state.status === "ready") {
        setOpened({ storage: state.storage, reason: null });
        setFailed(null);
      } else {
        setFailed(state.reason);
        setOpened(null);
      }
    });

    bootTimer = setTimeout(() => {
      if (cancelled) return;
      bootTimer = undefined;
      // The phase turns an unactionable "something went wrong" into a specific
      // one. "created" means the worker script never evaluated at all, which
      // points at the module failing to load; anything later means it ran and
      // stalled, which points at the engine or OPFS.
      setFailed(
        instance.lastPhase === "created"
          ? "The database worker never started loading. This is a build problem " +
              "rather than a data one — reloading usually fixes it."
          : `The database is stuck after "${instance.lastPhase}". The worker started ` +
              "but did not finish opening the database file.",
      );
    }, WORKER_BOOT_TIMEOUT_MS);

    return () => {
      cancelled = true;
      if (bootTimer !== undefined) clearTimeout(bootTimer);
      // Terminating resolves the instance's state promise, which the guard
      // above keeps from touching this run's state.
      instance.dispose();
    };
    // Re-run when `resetKey` changes. `db` intentionally excluded: the setter
    // above runs inside this effect, and depending on it would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  const value = useMemo<LocalDbContextValue>(() => {
    const status = opened
      ? "ready"
      : constructionError || failed
        ? "unavailable"
        : "opening";
    return {
      status,
      storage: opened?.storage ?? null,
      reason: constructionError ?? failed,
      db,
      ledger: db ? createLedger(db) : null,
      retry,
    };
  }, [db, opened, failed, constructionError, retry]);

  return (
    <LocalDbContext.Provider value={value}>{children}</LocalDbContext.Provider>
  );
}

/** Access the on-device database. `ledger` is populated once `status` is `"ready"`. */
export function useLocalDb(): LocalDbContextValue {
  return useContext(LocalDbContext);
}
