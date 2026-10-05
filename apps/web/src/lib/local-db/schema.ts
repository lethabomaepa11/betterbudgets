// The on-device database layer only runs in the browser â€” main thread or the
// SQLite worker â€” never on the server, so it is declared as a client module.
// That marker is also load-bearing: varlock's Turbopack loader injects an
// env-init into every module *without* it, and that init throws inside a
// Worker (no `window`, no `process.env`), which would kill the worker before
// it can open the database.
"use client";

// SQL shape for the on-device database.
//
// The model comes from a UML diagram, so the tables mirror it rather than a
// generic "budget app" schema:
//
//   profiles                   User (local, never a server account)
//   accounts                   Account, owned by User, Income/Expense/Savings/Investment
//   transactions               Transaction, PartOf Account + optional SourceAccount
//   recurring_transactions     RecurringTransaction -> Transaction
//   financial_goals            FinancialGoal -> Account
//   goal_recommendations       GoalAdjustmentRecommendation -> FinancialGoal
//
// Cross-cutting rules the whole layer depends on:
//
// * Money is INTEGER minor units. The diagram says `decimal`; a float can never
//   represent `0.1 + 0.2` correctly, so cents win.
// * Booleans are stored as 0/1 (`is_active`, `is_allowance`, `is_archived`).
// * Direction lives in `transactions.type` (Inflow/Outflow) and `amount` is
//   therefore never negative â€” which is what the diagram implies by splitting
//   the two apart.
// * Every syncable row carries `updated_at` / `deleted_at` / `origin`. Rows are
//   tombstoned rather than deleted, and `updated_at` drives last-write-wins, so
//   two devices that were offline at the same time can still converge.
// * Ids are client-generated UUIDs. Nothing depends on a server sequence, which
//   is what lets someone start budgeting before they have an account.

/** Bumped whenever `MIGRATIONS` gains an entry. Persisted via `PRAGMA user_version`. */
export const SCHEMA_VERSION = 10;

/** Tables that participate in sync. Credentials deliberately do not. */
export const SYNCABLE_TABLES = [
  "accounts",
  "transactions",
  "recurring_transactions",
  "planned_occurrences",
  "financial_goals",
  "goal_recommendations",
] as const;
export type SyncableTable = (typeof SYNCABLE_TABLES)[number];

/**
 * Ordered, append-only. Entry N takes the database from `user_version` N to
 * N+1. Never edit or reorder an entry that has shipped â€” add a new one instead.
 *
 * Entry 0 is the pre-release v1 layout and entry 1 replaces it with the model
 * above. A brand-new database runs both in sequence, so entry 0's tables are
 * created and then immediately dropped; that costs a few milliseconds once, and
 * the alternative (rewriting a shipped entry) is far worse.
 */
export const MIGRATIONS: readonly (readonly string[])[] = [
  // --- 1: pre-release v1 (superseded, retained for existing databases) ---
  [
    `CREATE TABLE accounts (
       id              TEXT PRIMARY KEY,
       name            TEXT NOT NULL,
       kind            TEXT NOT NULL DEFAULT 'checking',
       currency        TEXT NOT NULL DEFAULT 'USD',
       opening_balance INTEGER NOT NULL DEFAULT 0,
       archived_at     TEXT,
       updated_at      TEXT NOT NULL,
       deleted_at      TEXT,
       origin          TEXT
     )`,
    `CREATE TABLE categories (
       id         TEXT PRIMARY KEY,
       name       TEXT NOT NULL,
       kind       TEXT NOT NULL,
       color      TEXT,
       icon       TEXT,
       updated_at TEXT NOT NULL,
       deleted_at TEXT,
       origin     TEXT
     )`,
    `CREATE TABLE transactions (
       id          TEXT PRIMARY KEY,
       account_id  TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
       category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
       amount      INTEGER NOT NULL,
       note        TEXT,
       occurred_on TEXT NOT NULL,
       updated_at  TEXT NOT NULL,
       deleted_at  TEXT,
       origin      TEXT
     )`,
    `CREATE INDEX idx_transactions_occurred_on ON transactions(occurred_on)`,
    `CREATE INDEX idx_transactions_account ON transactions(account_id)`,
    `CREATE TABLE outbox (
       seq        INTEGER PRIMARY KEY AUTOINCREMENT,
       entity     TEXT NOT NULL,
       entity_id  TEXT NOT NULL,
       op         TEXT NOT NULL,
       payload    TEXT,
       created_at TEXT NOT NULL
     )`,
    `CREATE INDEX idx_outbox_seq ON outbox(seq)`,
    `CREATE TABLE meta (
       key   TEXT PRIMARY KEY,
       value TEXT NOT NULL
     )`,
  ],

  // --- 2: the diagram's model ---
  [
    // Children before parents. `IF EXISTS` covers a fresh database, which has
    // just created the v1 tables above; a v1 database already has them.
    `DROP TABLE IF EXISTS transactions`,
    `DROP TABLE IF EXISTS recurring_transactions`,
    `DROP TABLE IF EXISTS financial_goals`,
    `DROP TABLE IF EXISTS goal_recommendations`,
    `DROP TABLE IF EXISTS categories`,
    `DROP TABLE IF EXISTS accounts`,
    `DROP TABLE IF EXISTS outbox`,

    // The local profile. `salt`/`verifier` never leave the device and are never
    // written to the outbox â€” sync moves data, not credentials.
    `CREATE TABLE profiles (
       id              TEXT PRIMARY KEY,
       name            TEXT NOT NULL,
       credential_type TEXT NOT NULL CHECK (credential_type IN ('password','pin')),
       salt            TEXT NOT NULL,
       verifier        TEXT NOT NULL,
       kdf             TEXT NOT NULL DEFAULT 'PBKDF2-SHA256',
       iterations      INTEGER NOT NULL,
       failed_attempts INTEGER NOT NULL DEFAULT 0,
       locked_until    TEXT,
       created_at      TEXT NOT NULL,
       updated_at      TEXT NOT NULL,
       origin          TEXT
     )`,

    `CREATE TABLE accounts (
       id          TEXT PRIMARY KEY,
       profile_id  TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
       name        TEXT NOT NULL,
       type        TEXT NOT NULL CHECK (type IN ('income','expense','savings','investment')),
       balance     INTEGER,
       is_archived INTEGER NOT NULL DEFAULT 0,
       created_at  TEXT NOT NULL,
       updated_at  TEXT NOT NULL,
       deleted_at  TEXT,
       origin      TEXT
     )`,
    `CREATE INDEX idx_accounts_profile ON accounts(profile_id)`,

    `CREATE TABLE transactions (
       id                TEXT PRIMARY KEY,
       account_id        TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
       source_account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
       name              TEXT,
       amount            INTEGER NOT NULL CHECK (amount >= 0),
       type              TEXT NOT NULL CHECK (type IN ('inflow','outflow')),
       is_allowance      INTEGER NOT NULL DEFAULT 0,
       occurred_on       TEXT NOT NULL,
       created_at        TEXT NOT NULL,
       updated_at        TEXT NOT NULL,
       deleted_at        TEXT,
       origin            TEXT
     )`,
    `CREATE INDEX idx_transactions_occurred_on ON transactions(occurred_on)`,
    `CREATE INDEX idx_transactions_account ON transactions(account_id)`,
    `CREATE INDEX idx_transactions_source_account ON transactions(source_account_id)`,

    `CREATE TABLE recurring_transactions (
       id             TEXT PRIMARY KEY,
       transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
       frequency      TEXT NOT NULL CHECK (frequency IN ('daily','weekly','monthly','yearly')),
       is_active      INTEGER NOT NULL DEFAULT 1,
       next_due_date  TEXT NOT NULL,
       created_at     TEXT NOT NULL,
       updated_at     TEXT NOT NULL,
       deleted_at     TEXT,
       origin         TEXT
     )`,
    `CREATE INDEX idx_recurring_next_due ON recurring_transactions(next_due_date)`,

    `CREATE TABLE financial_goals (
       id             TEXT PRIMARY KEY,
       account_id     TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
       name           TEXT NOT NULL,
       target_amount  INTEGER NOT NULL,
       current_amount INTEGER NOT NULL DEFAULT 0,
       status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','impossible')),
       created_at     TEXT NOT NULL,
       updated_at     TEXT NOT NULL,
       deleted_at     TEXT,
       origin         TEXT
     )`,
    `CREATE INDEX idx_goals_account ON financial_goals(account_id)`,

    `CREATE TABLE goal_recommendations (
       id          TEXT PRIMARY KEY,
       goal_id     TEXT NOT NULL REFERENCES financial_goals(id) ON DELETE CASCADE,
       title       TEXT NOT NULL,
       description TEXT NOT NULL,
       created_at  TEXT NOT NULL,
       updated_at  TEXT NOT NULL,
       deleted_at  TEXT,
       origin      TEXT
     )`,
    `CREATE INDEX idx_recommendations_goal ON goal_recommendations(goal_id)`,

    `CREATE TABLE outbox (
       seq        INTEGER PRIMARY KEY AUTOINCREMENT,
       entity     TEXT NOT NULL,
       entity_id  TEXT NOT NULL,
       op         TEXT NOT NULL,
       payload    TEXT,
       created_at TEXT NOT NULL
     )`,
    `CREATE INDEX idx_outbox_seq ON outbox(seq)`,
  ],

  // --- 3: settings + recurrence linkage ---
  [
    // The vault's display currency. Stored on the profile so money stays
    // formatted consistently everywhere it is read, and defaulted for every
    // profile created before this version.
    // The vault's display currency. Stored on the profile so money stays
    // formatted consistently everywhere it is read, and defaulted for every
    // profile created before this version.
    `ALTER TABLE profiles ADD COLUMN currency TEXT NOT NULL DEFAULT 'USD'`,

    // Onboarding progress lives on the profile row rather than in its own table: it
    // is a single value that only ever answers "how far through setup is this
    // person", and folding it into `profiles` avoids a store that would need its
    // own migration path and its own sync rules.
    `ALTER TABLE profiles ADD COLUMN onboarding_step TEXT NOT NULL DEFAULT 'currency'`,
    `ALTER TABLE profiles ADD COLUMN budget_for TEXT`,

    // Links a generated occurrence back to the recurrence that produced it.
    // Without this there is no way to tell a rent payment generated from a
    // recurring rule from a one-off that happens to match, so "edit going
    // forward" and "edit this month only" cannot be told apart. Deliberately a
    // bare id with no FK: `recurring_transactions` is itself tombstoned, and a
    // cascade from a deleted rule would delete history the user still expects
    // to see in past months.
    `ALTER TABLE transactions ADD COLUMN recurring_id TEXT`,
    `CREATE INDEX idx_transactions_recurring ON transactions(recurring_id)`,
  ],

  // --- 4: budgeting vocabulary (account types, categories, budgets) ---
  //
  // The earlier model used account *types* to mean direction of money
  // ('income'/'expense'), which conflated "which pocket" with "money arriving or
  // leaving" and left no room for the accounts people actually open. This entry
  // re-keys the column to the real-world vocabulary and moves direction onto the
  // transaction, which already carries it.
  //
  // Safe rebuild: `migrate()` runs with foreign keys disabled and re-enables
  // them afterwards, because `transactions.account_id` is ON DELETE CASCADE and
  // dropping `accounts` with FKs on would delete every transaction. See migrate().
  [
    `CREATE TABLE accounts_v4 (
       id          TEXT PRIMARY KEY,
       profile_id  TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
       name        TEXT NOT NULL,
       type        TEXT NOT NULL CHECK (type IN ('checking','savings','credit','cash','investment','other')),
       balance     INTEGER,
       is_archived INTEGER NOT NULL DEFAULT 0,
       created_at  TEXT NOT NULL,
       updated_at  TEXT NOT NULL,
       deleted_at  TEXT,
       origin      TEXT
     )`,

    // Old -> new. 'income' and 'expense' were both "a pocket you transact
    // through", which is a checking account; savings/investment are unchanged.
    // 'other' has no predecessor, so nothing maps to it.
    `INSERT INTO accounts_v4 (id, profile_id, name, type, balance, is_archived, created_at, updated_at, deleted_at, origin)
     SELECT id, profile_id, name,
            CASE type
              WHEN 'savings' THEN 'savings'
              WHEN 'investment' THEN 'investment'
              ELSE 'checking'
            END,
            balance, is_archived, created_at, updated_at, deleted_at, origin
       FROM accounts`,

    `DROP TABLE accounts`,
    `ALTER TABLE accounts_v4 RENAME TO accounts`,
    `CREATE INDEX idx_accounts_profile ON accounts(profile_id)`,

    // Categories are the vocabulary a person actually thinks in ("Groceries",
    // "Rent"), which is deliberately *not* the same axis as the account type.
    // Groups are optional: a flat list is a group-less list, so a user with three
    // categories is not forced to invent a hierarchy they do not want.
    `CREATE TABLE category_groups (
       id         TEXT PRIMARY KEY,
       profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
       name       TEXT NOT NULL,
       color      TEXT,
       sort_order INTEGER NOT NULL DEFAULT 0,
       created_at TEXT NOT NULL,
       updated_at TEXT NOT NULL,
       deleted_at TEXT,
       origin     TEXT
     )`,
    `CREATE INDEX idx_category_groups_profile ON category_groups(profile_id)`,

    `CREATE TABLE categories (
       id          TEXT PRIMARY KEY,
       profile_id  TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
       group_id    TEXT REFERENCES category_groups(id) ON DELETE SET NULL,
       name        TEXT NOT NULL,
       kind        TEXT NOT NULL CHECK (kind IN ('income','expense')),
       icon        TEXT,
       color       TEXT,
       sort_order  INTEGER NOT NULL DEFAULT 0,
       is_archived INTEGER NOT NULL DEFAULT 0,
       created_at  TEXT NOT NULL,
       updated_at  TEXT NOT NULL,
       deleted_at  TEXT,
       origin      TEXT
     )`,
    `CREATE INDEX idx_categories_profile ON categories(profile_id)`,
    `CREATE INDEX idx_categories_group ON categories(group_id)`,

    // ON DELETE SET NULL, not CASCADE: archiving a category must not silently
    // delete the transactions filed under it. Past months still have to reconcile,
    // and an "archived" category that erased history would be a data-loss bug
    // dressed up as a feature.
    `ALTER TABLE transactions ADD COLUMN category_id TEXT REFERENCES categories(id) ON DELETE SET NULL`,
    `CREATE INDEX idx_transactions_category ON transactions(category_id)`,

    // Free-form notes. Separate from `name` because the name is what gets
    // grouped in reports, while notes are only ever read by the person who wrote
    // them â€” merging the two loses one or the other.
    `ALTER TABLE transactions ADD COLUMN notes TEXT`,

    // A budget is a period (October 2026) owning a line per category. Period is
    // stored as an explicit start date plus a cadence rather than a precomputed
    // end, so a weekly budget stays correct across month boundaries.
    `CREATE TABLE budgets (
       id         TEXT PRIMARY KEY,
       profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
       name       TEXT,
       period     TEXT NOT NULL CHECK (period IN ('weekly','monthly')),
       starts_on  TEXT NOT NULL,
       created_at TEXT NOT NULL,
       updated_at TEXT NOT NULL,
       deleted_at TEXT,
       origin     TEXT
     )`,
    `CREATE INDEX idx_budgets_profile ON budgets(profile_id)`,

    // One limit per category per budget. The UNIQUE pair is what makes "edit the
    // limit" an upsert instead of a second row that would double-count spend.
    `CREATE TABLE budget_items (
       id           TEXT PRIMARY KEY,
       budget_id    TEXT NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
       category_id  TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
       limit_amount INTEGER NOT NULL CHECK (limit_amount >= 0),
       created_at   TEXT NOT NULL,
       updated_at   TEXT NOT NULL,
       deleted_at   TEXT,
       origin       TEXT,
       UNIQUE (budget_id, category_id)
     )`,
    `CREATE INDEX idx_budget_items_budget ON budget_items(budget_id)`,
  ],

  // --- 5: planned occurrences (money that has not moved yet) ---
  //
  // Recurring money used to be stored as ordinary future transactions, which
  // quietly corrupted every number derived from `transactions`: balances,
  // monthly totals and the spending report all counted rent for months that had
  // not happened, so the dashboard told someone they were short before the rent
  // was even due.
  //
  // These rows are held separately and settle into real transactions only when
  // the user confirms them.
  [
    `CREATE TABLE planned_occurrences (
       id                   TEXT PRIMARY KEY,
       -- No FK to recurring_transactions: rules are tombstoned, and a cascade
       -- would take the paid history with them. Same reasoning as
       -- transactions.recurring_id.
       rule_id              TEXT,
       profile_id           TEXT NOT NULL,
       account_id           TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
       category_id          TEXT REFERENCES categories(id) ON DELETE SET NULL,
       name                 TEXT,
       amount               INTEGER NOT NULL CHECK (amount >= 0),
       type                 TEXT NOT NULL CHECK (type IN ('inflow', 'outflow')),
       due_on               TEXT NOT NULL,
       status               TEXT NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending', 'paid', 'skipped')),
       paid_transaction_id  TEXT,
       settled_on           TEXT,
       created_at           TEXT NOT NULL,
       updated_at           TEXT NOT NULL,
       deleted_at           TEXT,
       origin               TEXT
     )`,
    // The dashboard query is "pending, soonest first, for this profile", so that
    // is what the index serves. Deliberately partial: settled rows are history
    // and are never scanned by the hot path.
    `CREATE INDEX idx_planned_pending
       ON planned_occurrences(profile_id, due_on)
       WHERE status = 'pending' AND deleted_at IS NULL`,
    `CREATE INDEX idx_planned_rule ON planned_occurrences(rule_id)`,
    // One open occurrence per rule per date, so confirming twice (a double-tap,
    // or two tabs open) cannot create two payments.
    `CREATE UNIQUE INDEX idx_planned_rule_due
       ON planned_occurrences(rule_id, due_on)
       WHERE rule_id IS NOT NULL AND deleted_at IS NULL`,
    // How the rule picks its day, so a series can survive a month in which the
    // clamped date would otherwise become permanent. Defaults keep existing v4
    // rows meaningful: they were created as plain day-of-month series.
    `ALTER TABLE recurring_transactions ADD COLUMN anchor TEXT NOT NULL DEFAULT 'day_of_month'`,
    `ALTER TABLE recurring_transactions ADD COLUMN day_of_month INTEGER NOT NULL DEFAULT 1`,
    // A rule has to carry its own template. Pointing `transaction_id` at a
    // transaction cannot work: the occurrence that would be that template does
    // not exist until the user confirms something, so a brand-new rule would
    // have nothing to read its name, amount and account from, and topping up its
    // window later would silently generate nothing.
    `ALTER TABLE recurring_transactions ADD COLUMN account_id TEXT REFERENCES accounts(id) ON DELETE CASCADE`,
    `ALTER TABLE recurring_transactions ADD COLUMN category_id TEXT REFERENCES categories(id) ON DELETE SET NULL`,
    `ALTER TABLE recurring_transactions ADD COLUMN name TEXT`,
    `ALTER TABLE recurring_transactions ADD COLUMN amount INTEGER CHECK (amount IS NULL OR amount >= 0)`,
    `ALTER TABLE recurring_transactions ADD COLUMN tx_type TEXT CHECK (tx_type IS NULL OR tx_type IN ('inflow', 'outflow'))`,
  ],

  // --- 6: make a rule independent of any one transaction ---
  //
  // `recurring_transactions.transaction_id` was `NOT NULL REFERENCES
  // transactions(id) ON DELETE CASCADE`, which encodes the assumption that a rule
  // is generated from a transaction. That assumption no longer holds: a rule is
  // now created *before* any money moves, and the row it points at may not exist
  // yet.
  //
  // Two separate problems, and only fixing the first leaves a live one:
  //
  // 1. NOT NULL. Creating any rule at all failed with SQLITE_CONSTRAINT_NOTNULL.
  //    SQLite cannot relax a NOT NULL column with ALTER, so this is a rebuild.
  // 2. ON DELETE CASCADE. Even with the column nullable, deleting the transaction
  //    a rule was built from would delete the rule and every occurrence it still
  //    owes the user. A rule outlives its occurrences, so the dependency goes the
  //    other way round and is now expressed by a bare id.
  //
  // `day_of_month` defaults to 1 rather than being derived per-row: pre-v5 rules
  // have no template columns and cannot generate anything anyway (see syncRule),
  // so a day number for them is inert. Existing rows are carried across intact.
  [
    `CREATE TABLE recurring_transactions_v6 (
       id             TEXT PRIMARY KEY,
       -- Nullable and unconstrained on purpose. Kept as a bare id so an existing
       -- rule still records which transaction it came from, but nothing depends
       -- on that row existing and deleting it no longer removes the rule.
       transaction_id TEXT,
       frequency      TEXT NOT NULL CHECK (frequency IN ('daily','weekly','monthly','yearly')),
       anchor         TEXT NOT NULL DEFAULT 'day_of_month',
       day_of_month   INTEGER NOT NULL DEFAULT 1,
       is_active      INTEGER NOT NULL DEFAULT 1,
       next_due_date  TEXT NOT NULL,
       account_id     TEXT REFERENCES accounts(id) ON DELETE CASCADE,
       category_id    TEXT REFERENCES categories(id) ON DELETE SET NULL,
       name           TEXT,
       amount         INTEGER CHECK (amount IS NULL OR amount >= 0),
       tx_type        TEXT CHECK (tx_type IS NULL OR tx_type IN ('inflow', 'outflow')),
       created_at     TEXT NOT NULL,
       updated_at     TEXT NOT NULL,
       deleted_at     TEXT,
       origin         TEXT
     )`,

    `INSERT INTO recurring_transactions_v6
        (id, transaction_id, frequency, anchor, day_of_month, is_active, next_due_date,
         account_id, category_id, name, amount, tx_type, created_at, updated_at, deleted_at, origin)
     SELECT id, transaction_id, frequency, anchor, day_of_month, is_active, next_due_date,
            account_id, category_id, name, amount, tx_type,
            created_at, updated_at, deleted_at, origin
       FROM recurring_transactions`,

    // Order matters: the old table has to be gone before the new one can take
    // its name, and both have to happen before the index is recreated because
    // dropping a table takes its indexes with it.
    `DROP TABLE recurring_transactions`,
    `ALTER TABLE recurring_transactions_v6 RENAME TO recurring_transactions`,

    // Recreated under its original name, so anything already querying by it is
    // unaffected by the rebuild.
    `CREATE INDEX idx_recurring_next_due ON recurring_transactions(next_due_date)`,
  ],

  // --- 7: bind recurring rules to their owning profile ---
  //
  // The original recurring table reached ownership indirectly through its
  // template transaction. Rules are now created before a transaction exists,
  // so that relationship no longer exists. Store the profile explicitly, just
  // like planned occurrences do, so listing and syncing cannot lose a rule.
  [
    `ALTER TABLE recurring_transactions ADD COLUMN profile_id TEXT`,
    `UPDATE recurring_transactions
        SET profile_id = (
          SELECT a.profile_id
            FROM accounts a
           WHERE a.id = recurring_transactions.account_id
        )
      WHERE profile_id IS NULL`,
    `CREATE INDEX idx_recurring_profile ON recurring_transactions(profile_id)`,
  ],

  // --- 8: turn savings goals into dated plans ---
  [
    `ALTER TABLE financial_goals ADD COLUMN target_date TEXT`,
    `ALTER TABLE financial_goals ADD COLUMN monthly_required INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE financial_goals ADD COLUMN feasibility TEXT NOT NULL DEFAULT 'unknown'
       CHECK (feasibility IN ('comfortable','tight','impossible','unknown'))`,
    `ALTER TABLE financial_goals ADD COLUMN intent TEXT`,
  ],

  // --- 9: explicitly scope plans to their profile ---
  [
    `ALTER TABLE financial_goals ADD COLUMN profile_id TEXT`,
    `UPDATE financial_goals
        SET profile_id = (
          SELECT profile_id FROM accounts
           WHERE accounts.id = financial_goals.account_id
        )
      WHERE profile_id IS NULL`,
    `CREATE INDEX idx_goals_profile ON financial_goals(profile_id)`,
  ],

  // --- 10: durable sync cursor and idempotent outbox operations ---
  [
    `ALTER TABLE outbox ADD COLUMN operation_id TEXT`,
    `UPDATE outbox SET operation_id = 'legacy-' || CAST(seq AS TEXT) WHERE operation_id IS NULL`,
    `CREATE UNIQUE INDEX idx_outbox_operation_id ON outbox(operation_id)`,
    `CREATE TABLE sync_state (
       key TEXT PRIMARY KEY,
       value TEXT NOT NULL
     )`,
  ],
];

/**
 * Pragmas that must run on every connection. `foreign_keys` is off by default
 * in SQLite, so every `ON DELETE CASCADE` above would silently do nothing
 * without the first line.
 */
export const CONNECTION_PRAGMAS = [
  "PRAGMA foreign_keys = ON",
  "PRAGMA journal_mode = DELETE",
  "PRAGMA synchronous = FULL",
] as const;

// ---------------------------------------------------------------------------
// Enumerations, exactly as they appear in the diagram's Reflists.
// ---------------------------------------------------------------------------

export type CredentialType = "password" | "pin";

/**
 * Account.Type â€” which pocket the money sits in.
 *
 * Deliberately *not* "income"/"expense": those describe direction, which the
 * transaction already carries. An account is a place (checking, credit, cash), and
 * conflating the two is what left no room for a credit card or a cash wallet.
 */
export type AccountType =
  | "checking"
  | "savings"
  | "credit"
  | "cash"
  | "investment"
  | "other";

export const ACCOUNT_TYPES: readonly AccountType[] = [
  "checking",
  "savings",
  "credit",
  "cash",
  "investment",
  "other",
];

/**
 * Category.Kind â€” whether filing something here counts as money in or money out.
 *
 * Separate from the account type: a category answers "what was it for", an account
 * answers "which pocket", and a single category pair can span both.
 */
export type CategoryKind = "income" | "expense";

export const CATEGORY_KINDS: readonly CategoryKind[] = ["income", "expense"];

/** Budget.Period â€” how often a budget repeats. */
export type BudgetPeriod = "weekly" | "monthly";

export const BUDGET_PERIODS: readonly BudgetPeriod[] = ["weekly", "monthly"];

/** Transaction.Type */
export type TransactionType = "inflow" | "outflow";

/**
 * How a recurrence picks its day within a month.
 *
 * `day_of_month` alone cannot express the dates people actually get paid on.
 * "Last working day of the month" is the single most common one, and no
 * fixed-day rule can represent it: it moves with weekends and public holidays.
 * Storing the intent rather than a precomputed date is what lets the rule
 * survive into March, when the answer is different from February's.
 */
export type MonthlyAnchor =
  /** The same day number each month, clamped to the month's length. */
  | "day_of_month"
  /** First Monday, or the 1st when the month starts on one. */
  | "first_weekday"
  /** Last Mondayâ€“Friday of the month; falls back to the 28th-ish last day. */
  | "last_weekday"
  /** The final day of the month, whatever that turns out to be. */
  | "last_day";

export const MONTHLY_ANCHORS: readonly MonthlyAnchor[] = [
  "day_of_month",
  "first_weekday",
  "last_weekday",
  "last_day",
];

/** A recurrence rule, plus the fields a fixed frequency cannot express. */
export type RecurrenceRule = {
  frequency: RecurringFrequency;
  /** Only meaningful when `frequency` is `monthly`. */
  anchor: MonthlyAnchor;
  /**
   * The day number for `day_of_month`, kept on the rule so a monthly series
   * anchored to the 31st is still the 31st after a February clamp. Without this,
   * clamping on the 31st would permanently move the series to the 28th.
   */
  dayOfMonth: number;
};

/** RecurringTransaction.Frequency */
export type RecurringFrequency = "daily" | "weekly" | "monthly" | "yearly";

export const RECURRING_FREQUENCIES: readonly RecurringFrequency[] = [
  "daily",
  "weekly",
  "monthly",
  "yearly",
];

/** FinancialGoal.Status */
export type GoalStatus = "active" | "completed" | "impossible";

export const GOAL_STATUSES: readonly GoalStatus[] = ["active", "completed", "impossible"];

// ---------------------------------------------------------------------------
// Row types.
//
// SQLite stores booleans as 0/1 and decimal money as integers, so the
// `boolean` / `decimal` attributes from the diagram appear here as
// `number` â€” call sites convert explicitly rather than assuming.
// ---------------------------------------------------------------------------

/** The diagram's `User`, bound to this device. */
export type Profile = {
  id: string;
  name: string;
  credential_type: CredentialType;
  /** Base64, 16 random bytes. Per-profile, so identical PINs hash differently. */
  salt: string;
  /** Base64, PBKDF2-SHA256 output. Never leaves the device, never synced. */
  verifier: string;
  kdf: string;
  iterations: number;
  failed_attempts: number;
  locked_until: string | null;
  created_at: string;
  updated_at: string;
  origin: string | null;
  /** Display currency (ISO 4217). Added in schema v3. */
  currency: string;
  /** Where guided setup got to. Added in schema v4. */
  onboarding_step: OnboardingStep;
  /** What the person said they're budgeting for. Added in schema v4. */
  budget_for: BudgetFor | null;
};

/** The editable half of a profile: display preferences, never credentials. */
export type ProfileSettings = Pick<Profile, "currency" | "name">;

/**
 * Where the guided setup got to. Persisted on the profile so a user who closes
 * the tab mid-onboarding resumes where they left off rather than starting over.
 *
 * `done` is the terminal value. Steps are ordered, so "the furthest step reached"
 * could be derived from which columns are set â€” but deriving it means every new
 * step needs a migration, so it is stored explicitly instead.
 */
export type OnboardingStep =
  | "currency"
  | "purpose"
  | "account"
  | "categories"
  | "budget"
  | "done";

/** What the person is budgeting for. Only ever influences *suggestions*. */
export type BudgetFor =
  | "personal"
  | "household"
  | "student"
  | "family"
  | "business"
  | "other";

/** What the UI needs to list a profile â€” deliberately excludes the credential. */
export type ProfileSummary = Pick<
  Profile,
  "id" | "name" | "credential_type" | "failed_attempts" | "locked_until" | "currency"
  | "onboarding_step"
  | "budget_for"
>;

export type Account = {
  id: string;
  profile_id: string;
  name: string;
  type: AccountType;
  /** Minor units. `null` when the diagram's `Balance: decimal?` is unset. */
  balance: number | null;
  is_archived: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  origin: string | null;
};

export type Transaction = {
  id: string;
  account_id: string;
  /** `SourceAccount` â€” the leg money leaves, for a transfer. */
  source_account_id: string | null;
  name: string | null;
  /** Minor units, always non-negative; `type` carries the direction. */
  amount: number;
  type: TransactionType;
  is_allowance: number;
  occurred_on: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  origin: string | null;
  /** Set when this row is an occurrence generated from a recurring rule. */
  recurring_id: string | null;
  /** Added in schema v4. `null` means "not filed under any category". */
  category_id: string | null;
  /** Added in schema v4. Free-form, never used for grouping. */
  notes: string | null;
};

/**
 * A category group. Optional â€” `group_id` is nullable, so a flat list is a valid
 * list rather than a half-configured hierarchy.
 */
export type CategoryGroup = {
  id: string;
  profile_id: string;
  name: string;
  color: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  origin: string | null;
};

export type Category = {
  id: string;
  profile_id: string;
  group_id: string | null;
  name: string;
  kind: CategoryKind;
  /** Icon name, not a component reference, so it can sync as data. */
  icon: string | null;
  color: string | null;
  sort_order: number;
  is_archived: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  origin: string | null;
};

/** A budget period (October 2026) â€” the thing limits are measured against. */
export type Budget = {
  id: string;
  profile_id: string;
  name: string | null;
  period: BudgetPeriod;
  /** First day of the period, `YYYY-MM-DD`. */
  starts_on: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  origin: string | null;
};

/** One category's limit within a budget. */
export type BudgetItem = {
  id: string;
  budget_id: string;
  category_id: string;
  /** Minor units. Always non-negative. */
  limit_amount: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  origin: string | null;
};

export type RecurringTransaction = {
  id: string;
  transaction_id: string;
  profile_id: string | null;
  frequency: RecurringFrequency;
  /** Added in schema v5. Ignored unless `frequency` is `monthly`. */
  anchor: MonthlyAnchor;
  /** Added in schema v5. Survives a short-month clamp; see `RecurrenceRule`. */
  day_of_month: number;
  is_active: number;
  next_due_date: string;
  /**
   * The rule's own template. Added in schema v5: an occurrence is not created
   * until the user confirms it, so there is no transaction row for a new rule to
   * point at and every generated occurrence needs these fields.
   */
  account_id: string | null;
  category_id: string | null;
  name: string | null;
  amount: number | null;
  tx_type: TransactionType | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  origin: string | null;
};

export type FinancialGoal = {
  id: string;
  profile_id: string;
  account_id: string;
  name: string;
  target_amount: number;
  current_amount: number;
  status: GoalStatus;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  origin: string | null;
  target_date: string | null;
  monthly_required: number;
  feasibility: "comfortable" | "tight" | "impossible" | "unknown";
  intent: string | null;
};

export type GoalRecommendation = {
  id: string;
  goal_id: string;
  title: string;
  description: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  origin: string | null;
};

/**
 * One dated occurrence of a recurrence that has NOT happened yet.
 *
 * The distinction from `transactions` is the whole point of this table. Rent is
 * not money that has moved, so it must not sit in `transactions` â€” that table
 * feeds balances, monthly totals and the spending report, and a pre-materialised
 * future payment would already have been subtracted from the account by the time
 * the user was asked to confirm it.
 *
 * So a planned occurrence lives here until the user acts on it:
 *   `pending`  -> shown on the dashboard, awaiting a decision
 *   `paid`     -> became a real transaction (which is recorded in
 *                 `paid_transaction_id`); the occurrence stays as a receipt
 *   `skipped`  -> deliberately not done this cycle ("skip this month")
 */
export type OccurrenceStatus = "pending" | "paid" | "skipped";

export type PlannedOccurrence = {
  id: string;
  /** Null only when the rule itself was deleted; kept for history. */
  rule_id: string | null;
  profile_id: string;
  account_id: string;
  category_id: string | null;
  name: string | null;
  /** Minor units, always non-negative; `type` carries the direction. */
  amount: number;
  type: TransactionType;
  /** The date this occurrence is expected on, `YYYY-MM-DD`. */
  due_on: string;
  status: OccurrenceStatus;
  /** Set once confirmed, pointing at the transaction money actually moved in. */
  paid_transaction_id: string | null;
  /** When the user last changed the status, for "confirmed 2 days late" copy. */
  settled_on: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  origin: string | null;
};

export const OCCURRENCE_STATUSES: readonly OccurrenceStatus[] = ["pending", "paid", "skipped"];
