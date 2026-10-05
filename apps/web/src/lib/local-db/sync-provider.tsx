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
};

const SyncContext = createContext<SyncValue>({
  status: "idle",
  error: null,
  sync: async () => undefined,
});

export function SyncProvider({ children }: { children: React.ReactNode }) {
  const { data: session } = authClient.useSession();
  const { db, status: dbStatus } = useLocalDb();
  const { activeProfile } = useVault();
  const [status, setStatus] = useState<SyncValue["status"]>("idle");
  const [error, setError] = useState<string | null>(null);
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

  useEffect(() => {
    void sync();
  }, [sync]);

  return <SyncContext.Provider value={{ status, error, sync }}>{children}</SyncContext.Provider>;
}

export function useSync(): SyncValue {
  return useContext(SyncContext);
}

