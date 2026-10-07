// Typed reads and writes for the ledger, scoped to one local profile.
//
// Ownership follows the diagram's chain rather than a flat table:
// Transaction -> Account -> User(profile). So every query joins through
// `accounts` to reach `profile_id` instead of denormalising it onto rows,
// which would give two places for it to disagree.
//
// Every mutation writes its row *and* its `outbox` entry inside one
// transaction, so a device can later replay its changes without diffing the
// whole database.
import type { LocalDb } from "./client";
import type {
  Account,
  AccountType,
  FinancialGoal,
  Transaction,
  TransactionType,
} from "./schema";

export type NewTransaction = {
  accountId: string;
  /** Minor units, non-negative. `type` carries the direction. */
  amount: number;
  type: TransactionType;
  /** Local calendar day, `YYYY-MM-DD`. */
  occurredOn: string;
  sourceAccountId?: string | null;
  name?: string | null;
  isAllowance?: boolean;
  /** Added in schema v4. `null` files the transaction as uncategorised. */
  categoryId?: string | null;
  /** Added in schema v4. Free-form, never grouped in reports. */
  notes?: string | null;
};

export type MonthlyTotals = {
  /** Sum of `inflow` amounts, in minor units. */
  inflow: number;
  /** Sum of `outflow` amounts, in minor units. */
  outflow: number;
};

/**
 * Recent activity across every account, newest first.
 *
 * This is what the notifications surface reads. It deliberately spans both
 * directions and all accounts: "what did I just do" is not scoped to one
 * account, and filtering at read time would mean the caller assembling the same
 * union across several calls.
 */
export type ActivityQuery = {
  /** Restrict to one account. */
  accountId?: string;
  /** Restrict to one direction. */
  type?: TransactionType;
  /** `YYYY-MM-DD` inclusive lower bound. */
  from?: string;
  /** `YYYY-MM-DD` exclusive upper bound. */
  before?: string;
  limit?: number;
};

export type NewAccount = {
  name: string;
  type: AccountType;
  /** Minor units. `null` leaves the account's starting balance unset. */
  balance?: number | null;
};

export type AccountWithTotals = Account & {
  inflow: number;
  outflow: number;
  /** `inflow - outflow` over the account's lifetime, plus any stored balance. */
  net: number;
};

// Recurring money lives in ./occurrences, which keeps it out of `transactions`
// until the user confirms it. See PlannedOccurrence for why that matters.

function nowIso() {
  return new Date().toISOString();
}

/** The outbox entry for a write. `payload` is the row as a server would see it. */
function outboxStatement(entity: string, entityId: string, payload: unknown) {
  return {
    sql: "INSERT INTO outbox (operation_id, entity, entity_id, op, payload, created_at) VALUES (?, ?, ?, 'upsert', ?, ?)",
    bind: [crypto.randomUUID(), entity, entityId, payload === null ? null : JSON.stringify(payload), nowIso()],
  };
}

/** First instant of `month` (`YYYY-MM`) and of the month after it. */
function monthBounds(month: string): [string, string] {
  const [year, monthIndex] = month.split("-").map(Number);
  const nextYear = monthIndex === 12 ? year! + 1 : year!;
  const nextMonth = monthIndex === 12 ? 1 : monthIndex! + 1;
  return [`${month}-01`, `${nextYear}-${String(nextMonth).padStart(2, "0")}-01`];
}


export function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/** Today as a local calendar day, `YYYY-MM-DD`. */
export function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate(),
  ).padStart(2, "0")}`;
}

/** `YYYY-MM-DD` -> something like "12 Mar 2026". Parsed as UTC to match storage. */
export function formatDay(day: string): string {
  const parsed = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return day;
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(parsed);
}

/** Month label for a `YYYY-MM` string, e.g. "March 2026". */
export function formatMonthLabel(month: string): string {
  const parsed = new Date(`${month}-01T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return month;
  return new Intl.DateTimeFormat(undefined, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(parsed);
}

// Money formatting and parsing.
//
// Amounts are stored as INTEGER minor units (cents) everywhere, so every value
// crossing this boundary does so explicitly. Keeping the conversion in one place
// is what stops a `19.99` from silently becoming `19` in one screen and `20` in
// another.

/** Currencies offered in settings, in the order they appear in the picker. */
const CURRENCY_CODES = [
  "USD",
  "EUR",
  "GBP",
  "ZAR",
  "AUD",
  "CAD",
  "JPY",
  "INR",
  "NGN",
  "KES",
] as const;

export const SUPPORTED_CURRENCIES = CURRENCY_CODES;

/** Human-readable label for a currency code, e.g. "ZAR — South African rand". */
export function currencyLabel(code: string): string {
  const normalized = code.toUpperCase();
  try {
    const display = new Intl.DisplayNames(["en"], { type: "currency" }).of(normalized);
    return display ? `${normalized} — ${display}` : normalized;
  } catch {
    return normalized;
  }
}

/** True when this device's ICU data can actually format `code`. */
export function isSupportedCurrency(code: string): boolean {
  try {
    new Intl.NumberFormat(undefined, { style: "currency", currency: code });
    return true;
  } catch {
    return false;
  }
}

/**
 * Formatters are cached per currency. `Intl.NumberFormat` construction is
 * comparatively expensive and these are called once per list row, so building a
 * fresh one per row would show up on a long transaction list.
 */
const formatterCache = new Map<string, Intl.NumberFormat>();

function formatter(currency: string): Intl.NumberFormat {
  const cached = formatterCache.get(currency);
  if (cached) return cached;

  const created = new Intl.NumberFormat(undefined, {
    style: "currency",
    // An unrecognised stored code must not blank the screen, so fall back to the
    // code itself rather than throwing inside a render.
    currency: isSupportedCurrency(currency) ? currency : "USD",
    currencyDisplay: "narrowSymbol",
  });
  formatterCache.set(currency, created);
  return created;
}

/** Minor units -> display string. */
export function formatMoney(minor: number, currency = "USD"): string {
  return formatter(currency).format(minor / 100);
}

/** Minor units -> signed display string, for deltas and running balances. */
export function formatSignedMoney(minor: number, currency = "USD"): string {
  const sign = minor > 0 ? "+" : minor < 0 ? "â’" : "";
  return `${sign}${formatter(currency).format(Math.abs(minor) / 100)}`;
}

/**
 * User input (major units, e.g. "19.99") -> minor units, or `null` if unusable.
 *
 * Accepts either decimal separator, strips grouping characters and spaces, and
 * rounds half-away-from-zero so `Math.round` on a negative value (which rounds
 * toward +Infinity) can't produce a surprising result. Returns `null` rather
 * than throwing so a form can show a field-level error while the user types.
 */
export function parseMoney(input: string): number | null {
  const cleaned = input.replace(/[\sÂ ]/g, "").replace(/,/g, "");
  // A trailing or lone decimal point ("12." while typing) means zero minor units.
  if (cleaned === "" || cleaned === ".") return null;
  if (!/^-?\d*\.?\d*$/.test(cleaned)) return null;

  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;

  const minor = value < 0 ? -Math.round(-value * 100) : Math.round(value * 100);
  return minor;
}

/** Minor units -> the plain decimal string an input field should start with. */
export function moneyToInput(minor: number): string {
  return (minor / 100).toFixed(2);
}

export function createLedger(db: LocalDb) {
  return {
    /** Accounts the diagram's User owns, including Income/Expense envelopes. */
    async listAccounts(profileId: string): Promise<Account[]> {
      return db.query<Account>(
        `SELECT * FROM accounts
          WHERE profile_id = ? AND deleted_at IS NULL AND is_archived = 0
          ORDER BY name COLLATE NOCASE ASC`,
        [profileId],
      );
    },

    async countTransactions(profileId: string): Promise<number> {
      const rows = await db.query<{ count: number }>(
        `SELECT COUNT(*) AS count
           FROM transactions t
           JOIN accounts a ON a.id = t.account_id
          WHERE t.deleted_at IS NULL AND a.deleted_at IS NULL AND a.profile_id = ?`,
        [profileId],
      );
      return rows[0]?.count ?? 0;
    },

    /**
     * Totals for a calendar month, split by the diagram's Inflow/Outflow
     * distinction. Unlike the earlier signed-amount version this never has to
     * guess a sign â€” `transactions.type` already says which way money moved.
     */
    async monthlyTotals(
      profileId: string,
      month = currentMonth(),
    ): Promise<MonthlyTotals> {
      const [start, end] = monthBounds(month);
      const rows = await db.query<MonthlyTotals>(
        `SELECT
           COALESCE(SUM(CASE WHEN t.type = 'inflow' AND t.source_account_id IS NULL THEN t.amount ELSE 0 END), 0) AS inflow,
           COALESCE(SUM(CASE WHEN t.type = 'outflow' AND t.source_account_id IS NULL THEN t.amount ELSE 0 END), 0) AS outflow
           FROM transactions t
           JOIN accounts a ON a.id = t.account_id
          WHERE t.deleted_at IS NULL
            AND a.deleted_at IS NULL
            AND a.profile_id = ?
            AND t.occurred_on >= ? AND t.occurred_on < ?`,
        [profileId, start, end],
      );
      return rows[0] ?? { inflow: 0, outflow: 0 };
    },

    async listTransactions(profileId: string, limit = 50): Promise<Transaction[]> {
      return db.query<Transaction>(
        `SELECT t.*
           FROM transactions t
           JOIN accounts a ON a.id = t.account_id
          WHERE t.deleted_at IS NULL AND a.deleted_at IS NULL AND a.profile_id = ?
          ORDER BY t.occurred_on DESC, t.updated_at DESC
          LIMIT ?`,
        [profileId, limit],
      );
    },

    /**
     * Accounts with their inflow/outflow totals in one read.
     *
     * The sums are computed rather than read off `accounts.balance`, because the
     * stored column is only ever an *opening* figure â€” trusting it as a live
     * balance would silently ignore every transaction ever logged against the
     * account. `LEFT JOIN` keeps zero-activity accounts in the list, which
     * matters because a brand-new account should still be visible.
     */
    async listAccountsWithTotals(profileId: string): Promise<AccountWithTotals[]> {
      const rows = await db.query<AccountWithTotals>(
        `SELECT a.*,
                COALESCE(SUM(CASE
                  WHEN t.account_id = a.id AND t.type = 'inflow' THEN t.amount
                  ELSE 0
                END), 0) AS inflow,
                COALESCE(SUM(CASE
                  WHEN (t.account_id = a.id AND t.type = 'outflow')
                    OR (t.source_account_id = a.id AND t.account_id != a.id)
                  THEN t.amount
                  ELSE 0
                END), 0) AS outflow
           FROM accounts a
           LEFT JOIN transactions t
             ON (t.account_id = a.id OR t.source_account_id = a.id) AND t.deleted_at IS NULL
          WHERE a.deleted_at IS NULL AND a.is_archived = 0 AND a.profile_id = ?
          GROUP BY a.id
          ORDER BY a.name COLLATE NOCASE ASC`,
        [profileId],
      );
      return rows.map((row) => ({
        ...row,
        net: (row.inflow - row.outflow) + (row.balance ?? 0),
      }));
    },

    /** One account, still ownership-checked. */
    async getAccount(profileId: string, accountId: string): Promise<Account> {
      const [account] = await db.query<Account>(
        "SELECT * FROM accounts WHERE id = ? AND deleted_at IS NULL",
        [accountId],
      );
      if (!account || account.profile_id !== profileId) {
        throw new Error("That account does not exist.");
      }
      return account;
    },

    /**
     * Transactions on one account, newest first. Ownership is resolved through
     * the account row rather than trusted from the caller, so a transaction can
     * never be read by asking for an id from another profile.
     */
    async listAccountTransactions(
      profileId: string,
      accountId: string,
      limit = 100,
    ): Promise<Transaction[]> {
      await this.getAccount(profileId, accountId);
      return db.query<Transaction>(
        `SELECT t.*
           FROM transactions t
           JOIN accounts a ON a.id = t.account_id
          WHERE (t.account_id = ? OR t.source_account_id = ?)
            AND t.deleted_at IS NULL AND a.profile_id = ?
          ORDER BY t.occurred_on DESC, t.updated_at DESC
          LIMIT ?`,
        [accountId, accountId, profileId, limit],
      );
    },

    /**
     * Totals for one direction only â€” what the Income and Expenses screens show
     * above their lists. Same shape as `monthlyTotals` so a caller can swap
     * between them without reshaping its state.
     */
    async monthlyTotalsByType(
      profileId: string,
      type: TransactionType,
      month = currentMonth(),
    ): Promise<MonthlyTotals> {
      const [start, end] = monthBounds(month);
      const [row] = await db.query<{ total: number }>(
        `SELECT COALESCE(SUM(t.amount), 0) AS total
           FROM transactions t
           JOIN accounts a ON a.id = t.account_id
          WHERE t.deleted_at IS NULL
            AND t.type = ?
            AND t.source_account_id IS NULL
            AND a.deleted_at IS NULL
            AND a.profile_id = ?
            AND t.occurred_on >= ? AND t.occurred_on < ?`,
        [type, profileId, start, end],
      );
      const total = row?.total ?? 0;
      return type === "inflow" ? { inflow: total, outflow: 0 } : { inflow: 0, outflow: total };
    },

    /** Every transaction of one direction in a month, newest first. */
    async listTransactionsByType(
      profileId: string,
      type: TransactionType,
      month?: string,
      limit = 200,
    ): Promise<Transaction[]> {
      const params: (string | number)[] = [type, profileId];
      let window = "";
      if (month) {
        const [start, end] = monthBounds(month);
        window = "AND t.occurred_on >= ? AND t.occurred_on < ?";
        params.push(start, end);
      }
      params.push(limit);
      return db.query<Transaction>(
        `SELECT t.*
           FROM transactions t
           JOIN accounts a ON a.id = t.account_id
          WHERE t.deleted_at IS NULL
            AND t.type = ?
            AND t.source_account_id IS NULL
            AND a.deleted_at IS NULL
            AND a.profile_id = ?
            ${window}
          ORDER BY t.occurred_on DESC, t.updated_at DESC
          LIMIT ?`,
        params,
      );
    },

    /**
     * Edits an existing transaction.
     *
     * Ownership is proved by reading the row's account, not by comparing a
     * caller-supplied profile id â€” otherwise an id from another profile could be
     * paired with a matching account id and rewrite someone else's row.
     */
    async updateTransaction(
      profileId: string,
      transactionId: string,
      changes: {
        name?: string | null;
        amount?: number;
        type?: TransactionType;
        accountId?: string;
        occurredOn?: string;
        sourceAccountId?: string | null;
        /** Added in schema v4. Pass `null` to unfile the transaction. */
        categoryId?: string | null;
        /** Added in schema v4. */
        notes?: string | null;
      },
    ): Promise<Transaction> {
      const [existing] = await db.query<Transaction>(
        `SELECT t.*
           FROM transactions t
           JOIN accounts a ON a.id = t.account_id
          WHERE t.id = ? AND t.deleted_at IS NULL AND a.profile_id = ?`,
        [transactionId, profileId],
      );
      if (!existing) throw new Error("That transaction no longer exists.");

      const amount =
        changes.amount === undefined ? existing.amount : Math.round(changes.amount);
      if (!Number.isFinite(amount) || amount < 0) {
        throw new Error("Amount must be zero or more.");
      }

      const accountId = changes.accountId ?? existing.account_id;
      if (changes.accountId) await this.getAccount(profileId, changes.accountId);
      const type = changes.type ?? existing.type;
      const sourceAccountId =
        changes.sourceAccountId === undefined
          ? existing.source_account_id
          : changes.sourceAccountId;
      if (sourceAccountId) {
        if (sourceAccountId === accountId) {
          throw new Error("A transfer needs two different accounts.");
        }
        if (type !== "inflow") {
          throw new Error("Transfers must arrive as money in.");
        }
        await this.getAccount(profileId, sourceAccountId);
      }

      const name = changes.name === undefined ? existing.name : changes.name?.trim() || null;
      const occurredOn = changes.occurredOn ?? existing.occurred_on;
      const categoryId =
        changes.categoryId === undefined ? existing.category_id : changes.categoryId;
      // Ownership-checked like the account, so a caller cannot file this
      // transaction under another profile's category.
      if (categoryId) {
        const [owner] = await db.query<{ profile_id: string }>(
          "SELECT profile_id FROM categories WHERE id = ? AND deleted_at IS NULL",
          [categoryId],
        );
        if (!owner || owner.profile_id !== profileId) {
          throw new Error("That category does not exist.");
        }
      }
      const notes =
        changes.notes === undefined ? existing.notes : changes.notes?.trim() || null;
      const timestamp = nowIso();

      const row: Transaction = {
        ...existing,
        account_id: accountId,
        source_account_id: sourceAccountId,
        name,
        amount,
        type,
        occurred_on: occurredOn,
        category_id: categoryId,
        notes,
        updated_at: timestamp,
      };

      await db.batch([
        {
          sql: `UPDATE transactions
                  SET account_id = ?, source_account_id = ?, name = ?, amount = ?, type = ?,
                      occurred_on = ?, updated_at = ?, category_id = ?, notes = ?
                WHERE id = ?`,
          bind: [
            row.account_id,
            row.source_account_id,
            row.name,
            row.amount,
            row.type,
            row.occurred_on,
            timestamp,
            row.category_id,
            row.notes,
            transactionId,
          ],
        },
        outboxStatement("transactions", row.id, row),
      ]);

      return row;
    },

    /**
     * Recent activity across the profile, newest first. Backs the notifications
     * screen.
     *
     * The filters are assembled as bound parameters rather than interpolated â€”
     * the clause *strings* are fixed literals here, and only values are bound, so
     * there is no path for user input into the SQL text.
     */
    async listActivity(profileId: string, query: ActivityQuery = {}): Promise<Transaction[]> {
      const params: (string | number)[] = [profileId];
      const clauses: string[] = [
        "t.deleted_at IS NULL",
        "a.deleted_at IS NULL",
        "a.profile_id = ?",
      ];

      if (query.accountId) {
        clauses.push("(t.account_id = ? OR t.source_account_id = ?)");
        params.push(query.accountId);
        params.push(query.accountId);
      }
      if (query.type) {
        clauses.push("t.type = ?");
        params.push(query.type);
      }
      if (query.from) {
        clauses.push("t.occurred_on >= ?");
        params.push(query.from);
      }
      if (query.before) {
        clauses.push("t.occurred_on < ?");
        params.push(query.before);
      }
      params.push(query.limit ?? 50);

      return db.query<Transaction>(
        `SELECT t.*
           FROM transactions t
           JOIN accounts a ON a.id = t.account_id
          WHERE ${clauses.join(" AND ")}
          ORDER BY t.occurred_on DESC, t.updated_at DESC
          LIMIT ?`,
        params,
      );
    },

    /** Goals for every account the profile owns, with progress intact. */
    async listGoals(profileId: string): Promise<FinancialGoal[]> {
      return db.query<FinancialGoal>(
        `SELECT g.*
           FROM financial_goals g
           JOIN accounts a ON a.id = g.account_id
          WHERE g.deleted_at IS NULL AND a.deleted_at IS NULL AND a.profile_id = ?
          ORDER BY g.updated_at DESC`,
        [profileId],
      );
    },

    async addTransaction(profileId: string, input: NewTransaction): Promise<Transaction> {
      // Prove the account exists *and* belongs to this profile before the
      // insert, so a caller cannot attach a row to someone else's account.
      const [owner] = await db.query<{ profile_id: string }>(
        "SELECT profile_id FROM accounts WHERE id = ? AND deleted_at IS NULL",
        [input.accountId],
      );
      if (!owner || owner.profile_id !== profileId) {
        throw new Error("That account does not belong to this profile.");
      }
      if (input.sourceAccountId) {
        if (input.sourceAccountId === input.accountId) {
          throw new Error("A transfer needs two different accounts.");
        }
        const [sourceOwner] = await db.query<{ profile_id: string }>(
          "SELECT profile_id FROM accounts WHERE id = ? AND deleted_at IS NULL",
          [input.sourceAccountId],
        );
        if (!sourceOwner || sourceOwner.profile_id !== profileId) {
          throw new Error("That source account does not belong to this profile.");
        }
        if (input.type !== "inflow") {
          throw new Error("Transfers must arrive as money in.");
        }
      }

      const timestamp = nowIso();
      const row: Transaction = {
        id: crypto.randomUUID(),
        account_id: input.accountId,
        source_account_id: input.sourceAccountId ?? null,
        name: input.name?.trim() || null,
        // The diagram's `Amount: decimal` is stored as whole minor units, so
        // this guard is what keeps `19.99` from becoming `19` silently.
        amount: Math.round(input.amount),
        type: input.type,
        is_allowance: input.isAllowance ? 1 : 0,
        occurred_on: input.occurredOn,
        created_at: timestamp,
        updated_at: timestamp,
        deleted_at: null,
        origin: "local",
        recurring_id: null,
        category_id: input.categoryId ?? null,
        notes: input.notes ?? null,
      };

      await db.batch([
        {
          sql: `INSERT INTO transactions
                  (id, account_id, source_account_id, name, amount, type, is_allowance,
                   occurred_on, created_at, updated_at, origin, category_id, notes)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          bind: [
            row.id,
            row.account_id,
            row.source_account_id,
            row.name,
            row.amount,
            row.type,
            row.is_allowance,
            row.occurred_on,
            row.created_at,
            row.updated_at,
            row.origin,
            row.category_id,
            row.notes,
          ],
        },
        outboxStatement("transactions", row.id, row),
      ]);

      return row;
    },

    /**
     * Tombstones a transaction.
     *
     * A soft delete rather than a real `DELETE`: rows are part of the syncable
     * set, so a removal has to travel to other devices as a deletion, and past
     * months still need to reconcile. The outbox records `op = 'delete'` so a
     * future sync engine never mistakes it for an upsert.
     *
     * `scope: "future"` additionally retires the recurring rule that produced
     * this occurrence, which is what actually stops the *next* one appearing â€”
     * tombstoning a single row can only ever remove that one row.
     */
    async deleteTransaction(
      profileId: string,
      transactionId: string,
      options: { scope?: "this" | "future" } = {},
    ): Promise<void> {
      const scope = options.scope ?? "this";

      const [existing] = await db.query<Transaction>(
        `SELECT t.*
           FROM transactions t
           JOIN accounts a ON a.id = t.account_id
          WHERE t.id = ? AND t.deleted_at IS NULL AND a.profile_id = ?`,
        [transactionId, profileId],
      );
      if (!existing) throw new Error("That transaction no longer exists.");

      const timestamp = nowIso();
      const statements: Parameters<LocalDb["batch"]>[0][number][] = [];

      if (scope === "future" && existing.recurring_id) {
        statements.push({
          sql: `UPDATE recurring_transactions
                   SET is_active = 0, deleted_at = ?, updated_at = ?
                 WHERE id = ? AND deleted_at IS NULL`,
          bind: [timestamp, timestamp, existing.recurring_id],
        });
      }

      statements.push(
        {
          sql: "UPDATE transactions SET deleted_at = ?, updated_at = ? WHERE id = ?",
          bind: [timestamp, timestamp, transactionId],
        },
        {
          sql: `INSERT INTO outbox (operation_id, entity, entity_id, op, payload, created_at)
                VALUES (?, 'transactions', ?, 'delete', ?, ?)`,
          bind: [crypto.randomUUID(), transactionId, JSON.stringify({ id: transactionId }), timestamp],
        },
      );

      await db.batch(statements);
    },


    async createAccount(
      profileId: string,
      input: NewAccount,
    ): Promise<Account> {
      const timestamp = nowIso();
      const row: Account = {
        id: crypto.randomUUID(),
        profile_id: profileId,
        name: input.name.trim(),
        type: input.type,
        balance: input.balance ?? null,
        is_archived: 0,
        created_at: timestamp,
        updated_at: timestamp,
        deleted_at: null,
        origin: "local",
      };

      await db.batch([
        {
          sql: `INSERT INTO accounts
                  (id, profile_id, name, type, balance, is_archived, created_at, updated_at, origin)
                VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)`,
          bind: [
            row.id,
            row.profile_id,
            row.name,
            row.type,
            row.balance,
            row.created_at,
            row.updated_at,
            row.origin,
          ],
        },
        outboxStatement("accounts", row.id, row),
      ]);

      return row;
    },

    /** Renames an account or moves it between types. Ownership-checked. */
    async updateAccount(
      profileId: string,
      accountId: string,
      changes: { name?: string; type?: AccountType },
    ): Promise<Account> {
      const existing = await this.getAccount(profileId, accountId);

      const name = (changes.name ?? existing.name).trim();
      if (!name) throw new Error("An account needs a name.");

      const timestamp = nowIso();
      const row: Account = {
        ...existing,
        name,
        type: changes.type ?? existing.type,
        updated_at: timestamp,
      };

      await db.batch([
        {
          sql: "UPDATE accounts SET name = ?, type = ?, updated_at = ? WHERE id = ?",
          bind: [row.name, row.type, timestamp, accountId],
        },
        outboxStatement("accounts", row.id, row),
      ]);

      return row;
    },

    /**
     * Archives an account.
     *
     * A tombstone rather than a `DELETE`, because transactions cascade from the
     * account and past months still need to reconcile across devices. Archived
     * accounts drop out of the pickers but their history stays readable.
     */
    async archiveAccount(profileId: string, accountId: string): Promise<void> {
      await this.getAccount(profileId, accountId);

      const timestamp = nowIso();
      await db.batch([
        {
          sql: "UPDATE accounts SET is_archived = 1, updated_at = ? WHERE id = ?",
          bind: [timestamp, accountId],
        },
        {
          sql: "UPDATE recurring_transactions SET is_active = 0, updated_at = ? WHERE transaction_id IN (SELECT id FROM transactions WHERE account_id = ?)",
          bind: [timestamp, accountId],
        },
      ]);
    },
  };
}

export type Ledger = ReturnType<typeof createLedger>;
