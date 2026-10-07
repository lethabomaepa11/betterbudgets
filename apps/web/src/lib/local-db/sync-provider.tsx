"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

import { authClient } from "@/lib/auth-client";

import { useLocalDb } from "./provider";
import { syncNow } from "./sync";
import { useVault } from "./vault";

type SyncValue = {
  status: "idle" | "syncing" | "error";
  error: string | null;
  sync: () => Promise<void>;
  isOnline: boolean;
  lastSynced: number | null;
};

const SyncContext = createContext<SyncValue>({
  status: "idle",
  error: null,
  sync: async () => undefined,
  isOnline: true,
  lastSynced: null,
});

function registerBackgroundSync() {
  if ("serviceWorker" in navigator && "sync" in window.ServiceWorkerRegistration.prototype) {
    navigator.serviceWorker.ready.then((registration) => {
      registration.sync.register("sync-outbox").catch(console.error);
    });
  }
}

function requestPeriodicSync() {
  if ("serviceWorker" in navigator && "periodicSync" in window.ServiceWorkerRegistration.prototype) {
    navigator.serviceWorker.ready.then((registration) => {
      registration.periodicSync
        .register("sync-outbox", { minInterval: 15 * 60 * 1000 }) // 15 minutes
        .catch(() => {
          // Periodic sync not supported or permission denied
        });
    });
  }
}

export function SyncProvider({ children }: { children: React.ReactNode }) {
  const { data: session } = authClient.useSession();
  const { db, status: dbStatus } = useLocalDb();
  const { activeProfile } = useVault();
  const [status, setStatus] = useState<SyncValue["status"]>("idle");
  const [error, setError] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState(true);
  const [lastSynced, setLastSynced] = useState<number | null>(null);
  const running = useRef<Promise<void> | null>(null);

  const sync = useCallback(async () => {
    if (!db || dbStatus !== "ready" || !session?.user.id || !activeProfile) return;
    if (running.current) return running.current;
    const task = (async () => {
      setStatus("syncing");
      setError(null);
      try {
        await syncNow(db, session.user.id, activeProfile.id);
        setStatus("idle");
        setLastSynced(Date.now());
      } catch (cause) {
        setStatus("error");
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        running.current = null;
      }
    })();
    running.current = task;
    return task;
  }, [activeProfile, db, dbStatus, session?.user.id]);

  // Listen for online/offline events
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      void sync();
      registerBackgroundSync();
    };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    setIsOnline(navigator.onLine);

    // Initial sync on mount
    void sync();

    // Listen for service worker messages
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === "sync-complete") {
        setLastSynced(Date.now());
        setStatus("idle");
      }
    };
    navigator.serviceWorker?.addEventListener("message", handleMessage);

    // Register background sync and periodic sync
    if (navigator.onLine) {
      registerBackgroundSync();
      requestPeriodicSync();
    }

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      navigator.serviceWorker?.removeEventListener("message", handleMessage);
    };
  }, [sync]);

  return (
    <SyncContext.Provider value={{ status, error, sync, isOnline, lastSynced }}>
      {children}
    </SyncContext.Provider>
  );
}

export function useSync(): SyncValue {
  return useContext(SyncContext);
}

