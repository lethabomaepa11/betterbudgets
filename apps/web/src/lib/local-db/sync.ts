"use client";

import type { LocalDb } from "./client";
import type { Statement } from "./protocol";
import { SYNCABLE_TABLES, type SyncableTable } from "./schema";

const BATCH_SIZE = 100;
const STATE_PREFIX = "cursor:";
const SERVER_URL = (process.env.NEXT_PUBLIC_SERVER_URL ?? "").replace(/\/$/, "");

type Pending = {
  operation_id: string;
  entity: string;
  entity_id: string;
  op: "upsert" | "delete";
  payload: string | null;
};

type Change = {
  operationId: string;
  entity: string;
  entityId: string;
  payload: Record<string, unknown>;
  deleted: boolean;
  revision: number;
};

const columns: Record<SyncableTable, readonly string[]> = {
  accounts: ["id", "profile_id", "name", "type", "balance", "is_archived", "created_at", "updated_at", "deleted_at", "origin"],
  transactions: ["id", "account_id", "source_account_id", "name", "amount", "type", "is_allowance", "occurred_on", "created_at", "updated_at", "deleted_at", "origin", "recurring_id", "category_id", "notes"],
  recurring_transactions: ["id", "profile_id", "transaction_id", "frequency", "anchor", "day_of_month", "is_active", "next_due_date", "account_id", "source_account_id", "category_id", "name", "amount", "tx_type", "end_date", "created_at", "updated_at", "deleted_at", "origin"],
  planned_occurrences: ["id", "profile_id", "rule_id", "account_id", "source_account_id", "category_id", "name", "amount", "type", "due_on", "status", "paid_transaction_id", "settled_on", "created_at", "updated_at", "deleted_at", "origin"],
  financial_goals: ["id", "profile_id", "account_id", "name", "target_amount", "current_amount", "target_date", "monthly_required", "feasibility", "intent", "status", "created_at", "updated_at", "deleted_at", "origin"],
  goal_recommendations: ["id", "profile_id", "goal_id", "title", "description", "created_at", "updated_at", "deleted_at", "origin"],
};

function scalar(value: unknown): string | number | null {
  if (value === null || typeof value === "string" || typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  return JSON.stringify(value);
}

function tableFor(entity: string): SyncableTable | null {
  return (SYNCABLE_TABLES as readonly string[]).includes(entity)
    ? (entity as SyncableTable)
    : null;
}

async function readPending(db: LocalDb): Promise<Pending[]> {
  return db.query<Pending>(
    "SELECT operation_id, entity, entity_id, op, payload FROM outbox ORDER BY seq LIMIT ?",
    [BATCH_SIZE],
  );
}

async function pushBatch(db: LocalDb, operations: Pending[]): Promise<void> {
  const response = await fetch(`${SERVER_URL}/api/sync/push`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      operations: operations.map((operation) => ({
        operationId: operation.operation_id,
        entity: operation.entity,
        entityId: operation.entity_id,
        deleted: operation.op === "delete",
        payload: operation.payload ? JSON.parse(operation.payload) : {},
      })),
    }),
  });
  const result = (await response.json().catch(() => null)) as
    | { accepted?: string[]; error?: string }
    | null;
  if (!response.ok) throw new Error(result?.error ?? "Unable to push local changes.");

  const accepted = new Set(result?.accepted ?? []);
  if (accepted.size === 0) throw new Error("The server accepted no local changes.");
  const ids = [...accepted];
  await db.batch([
    {
      sql: `DELETE FROM outbox WHERE operation_id IN (${ids.map(() => "?").join(",")})`,
      bind: ids,
    },
  ]);
}

function applyChange(change: Change, profileId: string): Statement | null {
  const table = tableFor(change.entity);
  if (!table) return null;
  const allowed = columns[table];
  const payload: Record<string, unknown> = { ...change.payload, id: change.entityId };
  if (allowed.includes("profile_id")) payload.profile_id = profileId;
  const timestamp = new Date().toISOString();
  if (change.deleted) {
    return {
      sql: `UPDATE ${table} SET deleted_at = ?, updated_at = ? WHERE id = ?`,
      bind: [
        String(payload.deleted_at ?? timestamp),
        String(payload.updated_at ?? timestamp),
        change.entityId,
      ],
    };
  }

  const entries = allowed
    .filter((column) => Object.prototype.hasOwnProperty.call(payload, column))
    .map((column) => [column, scalar(payload[column])] as const);
  if (!entries.some(([column]) => column === "id")) return null;
  const names = entries.map(([column]) => column);
  const values = entries.map(([, value]) => value);
  const updates = names.filter((name) => name !== "id");
  return {
    sql: `INSERT INTO ${table} (${names.join(", ")}) VALUES (${names.map(() => "?").join(", ")})
          ON CONFLICT(id) DO UPDATE SET ${updates.map((name) => `${name}=excluded.${name}`).join(", ")}`,
    bind: values,
  };
}

async function pullPage(db: LocalDb, authUserId: string, profileId: string): Promise<boolean> {
  const [state] = await db.query<{ value: string }>(
    "SELECT value FROM sync_state WHERE key = ?",
    [`${STATE_PREFIX}${authUserId}`],
  );
  const cursor = Number(state?.value ?? "0");
  const response = await fetch(`${SERVER_URL}/api/sync/pull?after=${cursor}`, {
    credentials: "include",
  });
  const result = (await response.json().catch(() => null)) as
    | { changes?: Change[]; nextCursor?: number; hasMore?: boolean; error?: string }
    | null;
  if (!response.ok) throw new Error(result?.error ?? "Unable to pull remote changes.");
  const changes = result?.changes ?? [];
  const statements = changes
    .map((change) => applyChange(change, profileId))
    .filter((statement): statement is NonNullable<typeof statement> => statement !== null);
  const nextCursor = result?.nextCursor ?? cursor;
  statements.push({
    sql: "INSERT INTO sync_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    bind: [`${STATE_PREFIX}${authUserId}`, String(nextCursor)],
  });
  await db.batch(statements);
  return Boolean(result?.hasMore);
}

/** Pushes all pending local writes, then pulls and atomically applies every page. */
export async function syncNow(db: LocalDb, authUserId: string, profileId: string): Promise<void> {
  for (;;) {
    const pending = await readPending(db);
    if (pending.length === 0) break;
    await pushBatch(db, pending);
  }
  do {
    // The cursor is advanced in the same transaction as the applied rows.
  } while (await pullPage(db, authUserId, profileId));
}
