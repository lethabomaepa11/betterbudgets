/**
 * The occurrence lifecycle, asserted against a real SQLite database.
 *
 * The pure date maths has its own suite; this covers what only a real database
 * can check -- that confirming writes exactly one transaction, that a second
 * confirm is refused, and above all that *pending* occurrences never touch a
 * balance. That last one is the bug this feature exists to prevent, and it is
 * invisible in the type system.
 *
 * Run: node apps/web/scripts/verify-occurrences.mjs
 */
import assert from "node:assert/strict";

import sqlite3InitModule from "@sqlite.org/sqlite-wasm";

const { MIGRATIONS, SCHEMA_VERSION } = await import("../src/lib/local-db/schema.ts");

const SQLITE = await sqlite3InitModule({ print: () => {}, printErr: () => {} });

const PROFILE = "p1";
const ACCOUNT = "a1";

function open() {
  const db = new SQLITE.oo1.DB(":memory:", "c");
  db.exec("PRAGMA foreign_keys = ON");
  return db;
}

/**
 * Applies migrations up to `to`, the way `worker.ts` does.
 *
 * Two details are load-bearing and both were missed at first:
 *
 * - Only entries past the stored version run. Re-running an earlier entry fails
 *   (`table accounts already exists`), so a harness that replays everything from
 *   scratch would let a bug where an entry is accidentally re-runnable pass.
 * - `user_version` is stamped afterwards. Forgetting that leaves the database
 *   reporting the old version, and the next start would try to migrate again.
 */
function migrateTo(db, to) {
  const from = db.selectValue("PRAGMA user_version");
  if (from >= to) return;

  db.exec("PRAGMA foreign_keys = OFF");
  for (let version = from; version < to; version += 1) {
    for (const sql of MIGRATIONS[version]) db.exec(sql);
  }
  db.exec(`PRAGMA user_version = ${to}`);
  db.exec("PRAGMA foreign_keys = ON");
}

/** Builds a database at `to` from empty. */
function migrate(db, to = MIGRATIONS.length) {
  db.exec(`PRAGMA user_version = ${to}`);
  db.exec("PRAGMA foreign_keys = OFF");
  for (const statements of MIGRATIONS.slice(0, to)) {
    for (const sql of statements) db.exec(sql);
  }
  db.exec("PRAGMA foreign_keys = ON");
}

/**
 * `oo1.DB.exec` returns `{ filename }`, not the rows â€” results come back from
 * `selectObjects` / `selectValues`, and a write reports its row count through the
 * `changes()` method on that same return value. Getting this wrong reads as
 * "Cannot read properties of undefined (reading 'values')" rather than saying the
 * query failed, which is how a broken harness can look like a broken schema.
 */
function rows(db, sql, bind = []) {
  return db.selectObjects(sql, bind.length ? bind : undefined);
}

function countRows(db, table) {
  return db.selectValue(`SELECT COUNT(*) FROM ${table}`);
}

function objectsOf(db, sql, bind = []) {
  return db.selectValues(sql, bind.length ? bind : undefined);
}

function now() {
  return new Date().toISOString();
}

function seedProfile(db) {
  const ts = now();
  db.exec({
    sql: `INSERT INTO profiles
            (id, name, credential_type, salt, verifier, kdf, iterations,
             currency, onboarding_step, created_at, updated_at)
          VALUES (?, 'Test', 'pin', 'salt', 'verifier', 'PBKDF2-SHA256', 1, 'USD', 'done', ?, ?)`,
    bind: [PROFILE, ts, ts],
  });
  db.exec({
    sql: `INSERT INTO accounts (id, profile_id, name, type, balance, is_archived, created_at, updated_at)
          VALUES ('${ACCOUNT}', '${PROFILE}', 'Checking', 'checking', 0, 0, ?, ?)`,
    bind: [ts, ts],
  });
}

function seed(db) {
  migrate(db);
  seedProfile(db);
}

/** Balance exactly as the app computes it: stored balance plus signed transactions. */
function balance(db) {
  return rows(
    db,
    `SELECT COALESCE(a.balance, 0)
              + COALESCE((SELECT SUM(CASE WHEN t.type = 'inflow' THEN t.amount ELSE -t.amount END)
                            FROM transactions t
                           WHERE t.account_id = a.id AND t.deleted_at IS NULL), 0) AS net
       FROM accounts a WHERE a.id = ?`,
    [ACCOUNT],
  )[0]?.net ?? 0;
}

function insertOccurrence(db, { id, ruleId = "r1", amount = 120000, type = "outflow", dueOn = "2026-10-01" }) {
  const ts = now();
  db.exec({
    sql: `INSERT INTO planned_occurrences
            (id, rule_id, profile_id, account_id, name, amount, type, due_on, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, 'Rent', ?, ?, ?, 'pending', ?, ?)`,
    bind: [id, ruleId, PROFILE, ACCOUNT, amount, type, dueOn, ts, ts],
  });
}

let passed = 0;
function test(name, fn) {
  const db = open();
  try {
    fn(db);
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (cause) {
    const message = cause?.message ?? String(cause);
    // Newlines collapsed: the default AssertionError formatting is long enough
    // that the actual-vs-expected values scroll off the end of the message.
    console.log(`  FAIL  ${name} - ${message.replace(/\s+/g, " ").slice(0, 300)}`);
    process.exitCode = 1;
  } finally {
    db.close();
  }
}

test("a fresh database reaches the current schema version", (db) => {
  migrate(db);
    assert.equal(db.selectValue("PRAGMA user_version"), SCHEMA_VERSION);
});

test("the planned_occurrences table and its indexes exist", (db) => {
  migrate(db);
  const tables = objectsOf(db, "SELECT name FROM sqlite_master WHERE type = 'table'");
  assert.ok(tables.includes("planned_occurrences"), "table missing");
  const indexes = objectsOf(db, "SELECT name FROM sqlite_master WHERE type = 'index'");
  for (const name of ["idx_planned_pending", "idx_planned_rule", "idx_planned_rule_due"]) {
    assert.ok(indexes.includes(name), `missing index ${name}`);
  }
});

test("the unique index refuses two occurrences of one rule on one date", (db) => {
  seed(db);
  insertOccurrence(db, { id: "o1" });
  assert.throws(() => insertOccurrence(db, { id: "o2" }), /UNIQUE|constraint/i);
});

test("two different rules may both be due on the same date", (db) => {
  seed(db);
  insertOccurrence(db, { id: "o1", ruleId: "r1" });
  insertOccurrence(db, { id: "o2", ruleId: "r2" });
  assert.equal(countRows(db, "planned_occurrences"), 2);
});

test("a pending occurrence does not change the balance", (db) => {
  seed(db);
  const before = balance(db);
  insertOccurrence(db, { id: "o1" });
  // The bug this feature exists to prevent: a future bill must never be treated
  // as money already spent.
  assert.equal(balance(db), before);
  assert.equal(countRows(db, "transactions"), 0);
});

test("confirming writes one transaction and moves the balance", (db) => {
  seed(db);
  const ts = now();
  insertOccurrence(db, { id: "o1" });

  db.exec({
    sql: `INSERT INTO transactions
            (id, account_id, name, amount, type, occurred_on, created_at, updated_at)
          VALUES ('t1', ?, 'Rent', 120000, 'outflow', '2026-10-01', ?, ?)`,
    bind: [ACCOUNT, ts, ts],
  });
  db.exec({
    sql: `UPDATE planned_occurrences SET status = 'paid', paid_transaction_id = 't1'
           WHERE id = 'o1' AND status = 'pending'`,
    bind: [],
  });

  assert.equal(countRows(db, "transactions"), 1);
  assert.equal(balance(db), -120000);
  assert.equal(rows(db, "SELECT status FROM planned_occurrences WHERE id = 'o1'")[0].status, "paid");
});

test("confirming twice does not pay twice", (db) => {
  seed(db);
  const ts = now();
  insertOccurrence(db, { id: "o1", amount: 50000 });

  db.exec({
    sql: `INSERT INTO transactions
            (id, account_id, name, amount, type, occurred_on, created_at, updated_at)
          VALUES ('t1', ?, 'Rent', 50000, 'outflow', '2026-10-01', ?, ?)`,
    bind: [ACCOUNT, ts, ts],
  });

  // The second confirm is guarded by status = 'pending', so it matches nothing.
  // db.changes() rather than the exec return value: that value is the same
  // object every time, so calling changes() on it later still reports the
  // *last* statement rather than the one it came from.
  db.exec({
    sql: `UPDATE planned_occurrences SET status = 'paid', paid_transaction_id = 't1'
          WHERE id = 'o1' AND status = 'pending'`,
  });
  const first = db.changes();
  db.exec({
    sql: `UPDATE planned_occurrences SET status = 'paid', paid_transaction_id = 'OTHER'
          WHERE id = 'o1' AND status = 'pending'`,
  });
  const second = db.changes();

  assert.ok(first >= 1, "the first confirm should change a row");
  assert.equal(second, 0, "a second confirm must be a no-op");
  assert.equal(
    rows(db, "SELECT paid_transaction_id FROM planned_occurrences WHERE id = 'o1'")[0].paid_transaction_id,
    "t1",
    "the first confirm must win",
  );
});

test("the CHECK constraints reject bad amounts and statuses", (db) => {
  seed(db);
  const ts = now();
  const insert = (amount, status) =>
    db.exec({
      sql: `INSERT INTO planned_occurrences
              (id, rule_id, profile_id, account_id, name, amount, type, due_on, status, created_at, updated_at)
            VALUES ('o1', 'r1', ?, ?, 'Bad', ?, 'outflow', '2026-10-01', ?, ?, ?)`,
      bind: [PROFILE, ACCOUNT, amount, status, ts, ts],
    });

  assert.throws(() => insert(-5, "pending"), /CHECK|constraint/i, "negative amounts");
  assert.throws(() => insert(5, "maybe"), /CHECK|constraint/i, "unknown statuses");
});

test("deleting an account removes its occurrences", (db) => {
  seed(db);
  insertOccurrence(db, { id: "o1" });
  db.exec({ sql: "UPDATE accounts SET deleted_at = ? WHERE id = ?", bind: [now(), ACCOUNT] });
  db.exec({ sql: "DELETE FROM accounts WHERE id = ?", bind: [ACCOUNT] });
  assert.equal(countRows(db, "planned_occurrences"), 0, "no orphans left behind");
});

test("existing v4 data survives the migration to v5", (db) => {
  const ts = now();
  // A database stopped at v4, exactly as an existing user's would be.
  migrate(db, SCHEMA_VERSION - 1);
  assert.equal(
    db.selectValue("SELECT COUNT(*) FROM sqlite_master WHERE name = 'planned_occurrences'"),
    0,
    "v4 must not have the table yet",
  );

  seedProfile(db);
  db.exec({
    sql: `INSERT INTO transactions
            (id, account_id, name, amount, type, occurred_on, created_at, updated_at)
          VALUES ('t1', ?, 'Salary', 300000, 'inflow', '2026-09-01', ?, ?)`,
    bind: [ACCOUNT, ts, ts],
  });

  // Applied the way the worker does it: only the entries past the stored
  // version, so an entry that is accidentally re-runnable cannot hide here.
  migrateTo(db, SCHEMA_VERSION);

  assert.equal(db.selectValue("PRAGMA user_version"), SCHEMA_VERSION);
  assert.equal(countRows(db, "transactions"), 1, "the v4 transaction must be preserved");
  assert.equal(rows(db, "SELECT amount FROM transactions WHERE id = 't1'")[0].amount, 300000);
  assert.ok(
    objectsOf(db, "SELECT name FROM sqlite_master WHERE type = 'table'").includes("planned_occurrences"),
  );
  assert.equal(rows(db, "PRAGMA foreign_key_check").length, 0, "the upgrade must leave no orphans");
});

test("the v5 columns exist on recurring_transactions after upgrading", (db) => {
  migrate(db, SCHEMA_VERSION - 1);
  migrateTo(db, SCHEMA_VERSION);

  // `PRAGMA table_info` puts the column name at index 1, and `selectValues` only
  // returns the first column — so this reads the names out of `selectObjects`.
  const columns = rows(db, "PRAGMA table_info(recurring_transactions)").map((row) => row.name);
  for (const column of [
    "anchor",
    "day_of_month",
    "account_id",
    "category_id",
    "name",
    "amount",
    "tx_type",
  ]) {
    assert.ok(columns.includes(column), `recurring_transactions is missing ${column}`);
  }
});

test("no foreign key violations after migration", (db) => {
  seed(db);
  assert.equal(rows(db, "PRAGMA foreign_key_check").length, 0);
});

console.log(`\n${passed} occurrence database checks passed`);


