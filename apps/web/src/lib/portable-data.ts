"use client";

import type { LocalDb } from "./local-db/client";

export const PORTABLE_MAGIC = "BETTERBUDGETS-DATA";
export const PORTABLE_VERSION = 1;

type PortableRecord = {
  type: "account" | "category" | "transaction" | "budget" | "budget_item";
  values: string[];
};

export type PortableData = {
  currency: string;
  records: PortableRecord[];
};

export async function replaceProfileData(
  db: LocalDb,
  profileId: string,
  portable: PortableData,
) {
  const accounts = new Map<string, string>();
  const categories = new Map<string, string>();
  const budgets = new Map<string, string>();
  const now = new Date().toISOString();
  const id = () => crypto.randomUUID();
  const statements: Parameters<LocalDb["batch"]>[0][number][] = [
    { sql: "DELETE FROM planned_occurrences WHERE rule_id IN (SELECT id FROM recurring_transactions WHERE profile_id = ?)", bind: [profileId] },
    { sql: "DELETE FROM recurring_transactions WHERE profile_id = ?", bind: [profileId] },
    { sql: "DELETE FROM budget_items WHERE budget_id IN (SELECT id FROM budgets WHERE profile_id = ?)", bind: [profileId] },
    { sql: "DELETE FROM budgets WHERE profile_id = ?", bind: [profileId] },
    { sql: "DELETE FROM transactions WHERE account_id IN (SELECT id FROM accounts WHERE profile_id = ?)", bind: [profileId] },
    { sql: "DELETE FROM categories WHERE profile_id = ?", bind: [profileId] },
    { sql: "DELETE FROM accounts WHERE profile_id = ?", bind: [profileId] },
  ];

  for (const record of portable.records) {
    const [oldId, ...values] = record.values;
    if (!oldId) continue;
    if (record.type === "account") {
      const next = id();
      accounts.set(oldId, next);
      const [name, type, balance, archived] = values;
      statements.push({
        sql: "INSERT INTO accounts (id,profile_id,name,type,balance,is_archived,created_at,updated_at,origin) VALUES (?,?,?,?,?,?,?,?,?)",
        bind: [next, profileId, name, type, Number(balance) || 0, Number(archived) || 0, now, now, "import"],
      });
    } else if (record.type === "category") {
      const next = id();
      categories.set(oldId, next);
      const [name, kind, icon, color, sortOrder, archived] = values;
      statements.push({
        sql: "INSERT INTO categories (id,profile_id,name,kind,icon,color,sort_order,is_archived,created_at,updated_at,origin) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        bind: [next, profileId, name, kind, icon || null, color || null, Number(sortOrder) || 0, Number(archived) || 0, now, now, "import"],
      });
    } else if (record.type === "budget") {
      const next = id();
      budgets.set(oldId, next);
      const [name, period, startsOn] = values;
      statements.push({
        sql: "INSERT INTO budgets (id,profile_id,name,period,starts_on,created_at,updated_at,origin) VALUES (?,?,?,?,?,?,?,?)",
        bind: [next, profileId, name || null, period, startsOn, now, now, "import"],
      });
    }
  }

  for (const record of portable.records) {
    const [oldId, ...values] = record.values;
    if (record.type === "transaction") {
      const [accountId, sourceId, name, amount, type, allowance, occurredOn, categoryId, notes] = values;
      const accountIdNew = accounts.get(accountId ?? "");
      if (!accountIdNew) continue;
      statements.push({
        sql: "INSERT INTO transactions (id,account_id,source_account_id,name,amount,type,is_allowance,occurred_on,category_id,notes,created_at,updated_at,origin) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
        bind: [id(), accountIdNew, sourceId ? accounts.get(sourceId) ?? null : null, name || null, Number(amount) || 0, type, Number(allowance) || 0, occurredOn, categoryId ? categories.get(categoryId) ?? null : null, notes || null, now, now, "import"],
      });
    } else if (record.type === "budget_item") {
      const [budgetId, categoryId, limit] = values;
      const budgetIdNew = budgets.get(budgetId ?? "");
      const categoryIdNew = categories.get(categoryId ?? "");
      if (budgetIdNew && categoryIdNew) {
        statements.push({
          sql: "INSERT INTO budget_items (id,budget_id,category_id,limit_amount,created_at,updated_at,origin) VALUES (?,?,?,?,?,?,?)",
          bind: [id(), budgetIdNew, categoryIdNew, Number(limit) || 0, now, now, "import"],
        });
      }
    }
  }

  await db.batch(statements);
}

function encodeField(value: unknown) {
  const text = value == null ? "" : String(value);
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeField(value: string) {
  const binary = atob(value);
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
}

export function encodePortableData(data: PortableData) {
  const lines = [`${PORTABLE_MAGIC}\t${PORTABLE_VERSION}`, `C\t${encodeField(data.currency)}`];
  for (const record of data.records) {
    lines.push(`${record.type[0]!.toUpperCase()}\t${record.values.map(encodeField).join("\t")}`);
  }

  return `${lines.join("\n")}\n`;
}

export function encodePortableLink(data: PortableData) {
  const bytes = new TextEncoder().encode(encodePortableData(data));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodePortableLink(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  const binary = atob(padded);
  return decodePortableData(new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0))));
}

export function decodePortableData(source: string): PortableData {
  const lines = source.replace(/^\uFEFF/, "").trim().split(/\r?\n/);
  const [magic, version] = lines[0]?.split("\t") ?? [];
  if (magic !== PORTABLE_MAGIC || version !== String(PORTABLE_VERSION)) {
    throw new Error("That file is not a supported Better Budgets data file.");
  }

  let currency = "USD";
  const records: PortableRecord[] = [];
  const types: Record<string, PortableRecord["type"]> = {
    A: "account",
    K: "category",
    T: "transaction",
    B: "budget",
    I: "budget_item",
  };

  for (const line of lines.slice(1)) {
    if (!line) continue;
    const [kind, ...fields] = line.split("\t");
    if (kind === "C") {
      currency = decodeField(fields[0] ?? "");
      continue;
    }
    const type = types[kind ?? ""];
    if (!type) throw new Error("That data file contains an unknown record.");
    records.push({ type, values: fields.map(decodeField) });
  }

  if (!currency || records.length === 0) {
    throw new Error("That data file does not contain any portable budget data.");
  }
  return { currency, records };
}
