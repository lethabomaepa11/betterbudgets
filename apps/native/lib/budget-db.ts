import * as SQLite from "expo-sqlite";

export type Account = { id: string; name: string; type: string; balance: number };
export type Transaction = {
  id: string;
  accountId: string;
  merchant: string;
  amount: number;
  type: "income" | "expense";
  date: string;
};
export type Plan = { id: string; name: string; amount: number; cadence: string; nextDate: string };

let databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function database() {
  databasePromise ??= SQLite.openDatabaseAsync("betterbudgets.db");
  const db = await databasePromise;
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, type TEXT NOT NULL, balance REAL NOT NULL);
    CREATE TABLE IF NOT EXISTS transactions (id TEXT PRIMARY KEY NOT NULL, account_id TEXT NOT NULL, merchant TEXT NOT NULL, amount REAL NOT NULL, type TEXT NOT NULL, date TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS plans (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, amount REAL NOT NULL, cadence TEXT NOT NULL, next_date TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sync_queue (operation_id TEXT PRIMARY KEY NOT NULL, entity TEXT NOT NULL, entity_id TEXT NOT NULL, payload TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS sync_meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
  `);
  return db;
}

export async function loadBudget() {
  const db = await database();
  const [accounts, transactions, plans] = await Promise.all([
    db.getAllAsync<Account>("SELECT id, name, type, balance FROM accounts ORDER BY name"),
    db.getAllAsync<Transaction>(
      "SELECT id, account_id as accountId, merchant, amount, type, date FROM transactions ORDER BY date DESC",
    ),
    db.getAllAsync<Plan>(
      "SELECT id, name, amount, cadence, next_date as nextDate FROM plans ORDER BY next_date",
    ),
  ]);
  return { accounts, transactions, plans };
}

export async function addTransaction(input: Omit<Transaction, "id">) {
  const id = crypto.randomUUID();
  const db = await database();
  await db.runAsync(
    "INSERT INTO transactions (id, account_id, merchant, amount, type, date) VALUES (?, ?, ?, ?, ?, ?)",
    id,
    input.accountId,
    input.merchant,
    input.amount,
    input.type,
    input.date,
  );
  await db.runAsync(
    "UPDATE accounts SET balance = balance + ? WHERE id = ?",
    input.type === "income" ? input.amount : -input.amount,
    input.accountId,
  );
  await db.runAsync(
    "INSERT INTO sync_queue (operation_id, entity, entity_id, payload) VALUES (?, ?, ?, ?)",
    crypto.randomUUID(),
    "transactions",
    id,
    JSON.stringify({ ...input, id }),
  );
}

export async function getSyncBatch() {
  const db = await database();
  return db.getAllAsync<{ operationId: string; entity: string; entityId: string; payload: string; deleted: number }>(
    "SELECT operation_id as operationId, entity, entity_id as entityId, payload, deleted FROM sync_queue LIMIT 100",
  );
}

export async function clearSyncBatch(operationIds: string[]) {
  if (!operationIds.length) return;
  const db = await database();
  await db.runAsync(
    `DELETE FROM sync_queue WHERE operation_id IN (${operationIds.map(() => "?").join(",")})`,
    ...operationIds,
  );
}

export async function getSyncCursor() {
  const db = await database();
  const row = await db.getFirstAsync<{ value: string }>("SELECT value FROM sync_meta WHERE key = 'cursor'");
  return Number(row?.value ?? 0);
}

export async function setSyncCursor(cursor: number) {
  const db = await database();
  await db.runAsync(
    "INSERT INTO sync_meta (key, value) VALUES ('cursor', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    String(cursor),
  );
}

export async function applySyncChanges(changes: Array<{ entity: string; entityId: string; payload: unknown; deleted: boolean }>) {
  const db = await database();
  for (const change of changes) {
    const payload = (change.payload ?? {}) as Record<string, unknown>;
    if (change.entity === "accounts") {
      if (change.deleted) await db.runAsync("DELETE FROM accounts WHERE id = ?", change.entityId);
      else await db.runAsync(
        "INSERT INTO accounts (id, name, type, balance) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, type = excluded.type, balance = excluded.balance",
        change.entityId,
        String(payload.name ?? "Account"),
        String(payload.type ?? "other"),
        Number(payload.balance ?? 0),
      );
    }
    if (change.entity === "transactions") {
      if (change.deleted) await db.runAsync("DELETE FROM transactions WHERE id = ?", change.entityId);
      else await db.runAsync(
        "INSERT INTO transactions (id, account_id, merchant, amount, type, date) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET account_id = excluded.account_id, merchant = excluded.merchant, amount = excluded.amount, type = excluded.type, date = excluded.date",
        change.entityId,
        String(payload.accountId ?? payload.account_id ?? ""),
        String(payload.name ?? payload.merchant ?? "Transaction"),
        Number(payload.amount ?? 0),
        payload.type === "inflow" ? "income" : "expense",
        String(payload.occurredOn ?? payload.occurred_on ?? new Date().toISOString()),
      );
    }
  }
}
