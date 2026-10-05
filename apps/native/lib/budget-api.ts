import { ENV } from "@/src/env";
import { applySyncChanges, clearSyncBatch, getSyncBatch, getSyncCursor, setSyncCursor } from "./budget-db";

const baseUrl = ENV.EXPO_PUBLIC_SERVER_URL.replace(/\/$/, "");

export async function syncBudget() {
  const batch = await getSyncBatch();
  if (batch.length) {
    const response = await fetch(`${baseUrl}/api/sync/push`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        operations: batch.map((item) => ({
          operationId: item.operationId,
          entity: item.entity,
          entityId: item.entityId,
          deleted: Boolean(item.deleted),
          payload: JSON.parse(item.payload),
        })),
      }),
    });
    if (!response.ok) throw new Error(response.status === 401 ? "Sign in to sync your budget." : "Sync is unavailable.");
    const result = (await response.json()) as { accepted: string[] };
    await clearSyncBatch(result.accepted);
  }

  const cursor = await getSyncCursor();
  const response = await fetch(`${baseUrl}/api/sync/pull?after=${cursor}`, {
    credentials: "include",
  });
  if (!response.ok) throw new Error(response.status === 401 ? "Sign in to sync your budget." : "Sync is unavailable.");
  const result = (await response.json()) as {
    nextCursor: number;
    changes: Array<{ entity: string; entityId: string; payload: unknown; deleted: boolean }>;
  };
  await applySyncChanges(result.changes);
  await setSyncCursor(result.nextCursor);
  return { pushed: batch.length, pulled: result.changes.length };
}
