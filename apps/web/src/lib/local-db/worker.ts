// The SQLite worker. This is the only place a database handle exists.
//
// Why a worker at all: the OPFS storage backend needs `FileSystemSyncAccessHandle`,
// which is only exposed inside a Worker. That constraint is actually what keeps
// this cheap to deploy — the SAHPool VFS below needs no `SharedArrayBuffer`, so
// the app needs no COOP/COEP headers and therefore keeps working with
// cross-origin auth, OAuth popups and third-party embeds.
//
// The `"use client"` pragma below is load-bearing, not decorative: varlock's
// Turbopack loader injects an env-init into every module that lacks it, and
// that init throws inside a Worker (no `window`, no `process.env`) — killing
// this worker before `boot()` ever runs. Declaring the module client-only is
// what keeps the injection out.
"use client";

import sqlite3InitModuleRaw from "@sqlite.org/sqlite-wasm";

import type {
  QueryResult,
  Statement,
  WorkerError,
  WorkerRequest,
  WorkerResponse,
  WorkerStorage,
} from "./protocol";
import { CONNECTION_PRAGMAS, MIGRATIONS, SCHEMA_VERSION } from "./schema";

type Sqlite3 = Awaited<ReturnType<typeof sqlite3InitModuleRaw>>;

/**
 * The library intentionally omits the parameter list from its `init()` type, so
 * passing `locateFile` needs a cast. `locateFile` is Emscripten's documented
 * hook; `scripts/copy-sqlite-wasm.mjs` explains why we redirect it.
 */
const sqlite3InitModule = sqlite3InitModuleRaw as unknown as (options?: {
  locateFile?: (path: string) => string;
}) => Promise<Sqlite3>;

/** Structural view of the handful of `oo1` methods we use. */
type SqliteStatement = {
  bind: (values: unknown[]) => unknown;
  getColumnNames: (target?: string[]) => string[];
  step: () => boolean;
  get: (ndx: unknown[]) => unknown[];
  finalize: () => unknown;
};

type SqliteHandle = {
  exec: (sql: string) => unknown;
  prepare: (sql: string) => SqliteStatement;
};

// Minimal view of the worker global scope. Importing the `webworker` lib would
// conflict with the DOM lib the rest of the app compiles against.
type WorkerScope = {
  postMessage: (message: WorkerResponse) => void;
  addEventListener: {
    (
      type: "message",
      listener: (event: MessageEvent<WorkerRequest>) => void,
    ): void;
    (type: "error", listener: (event: ErrorEvent) => void): void;
    (
      type: "unhandledrejection",
      listener: (event: PromiseRejectionEvent) => void,
    ): void;
  };
};

const ctx = self as unknown as WorkerScope;

/**
 * Boot diagnostics. From the main thread a worker that never reaches `boot()` is
 * silent — no `ready`, no `error` — which is indistinguishable from a slow one.
 *
 * Deliberately posted rather than logged, and registered *before* the heartbeat
 * rather than after: this module is bundled with console-ninja's `oo_*` wrappers,
 * and the first `console.*` call in a Worker evaluates its DOM-dependent payload
 * on the spot. Doing that at module scope, before these handlers exist, kills the
 * worker during evaluation — which looks exactly like "stuck on loading" with a
 * silent console, because the failure happens inside the log call itself.
 */
ctx.addEventListener("error", (event) => {
  const reason = event.message || "The SQLite worker failed to load.";
  post({ kind: "ready", storage: "unavailable", reason });
});

ctx.addEventListener("unhandledrejection", (event) => {
  const reason =
    event.reason instanceof Error ? event.reason.message : String(event.reason);
  post({ kind: "ready", storage: "unavailable", reason });
});

// Heartbeat via postMessage so it cannot be swallowed by the console wrapper.
post({ kind: "evaluating" });

/** Registered VFS name and its private OPFS directory. */
const VFS_NAME = "betterbudgets";
const VFS_DIRECTORY = "/betterbudgets";
const DATABASE_FILE = "/budget.sqlite3";

let database: SqliteHandle | null = null;

/** Generous ceilings: a healthy boot finishes in well under a second. */
const ENGINE_LOAD_TIMEOUT_MS = 15_000;
const OPFS_OPEN_TIMEOUT_MS = 12_000;

/**
 * Whether this worker may touch `console`.
 *
 * The bundler wraps `console.*` with console-ninja, whose first invocation
 * evaluates a payload that expects a DOM. Inside a Worker that throws — and
 * because it throws *inside the log call*, everything after it in that function
 * is skipped. A module-scope log therefore kills the worker before it can
 * register a handler or report `ready`, and even a log placed first inside a
 * catch block swallows the report that follows it.
 *
 * Kept (rather than deleted) because these lines are genuinely useful when
 * console-ninja is off. `safeLog` swallows the failure instead of propagating it.
 * Set to `false` to make every log here a no-op.
 */
let WORKER_CONSOLE_SAFE = false;

/**
 * `console` that can never throw.
 *
 * The whole point: a diagnostic must not be able to take down the thing it is
 * diagnosing. Every call is wrapped so that console-ninja's DOM-dependent
 * payload failing in a Worker costs us the message, not the database.
 */
function safeLog(level: "log" | "warn" | "error", ...args: unknown[]): void {
  if (!WORKER_CONSOLE_SAFE) return;
  try {
    console[level](...args);
  } catch {
    // A broken console wrapper is not worth failing the boot over.
  }
}

/**
 * Rejects if `promise` neither resolves nor rejects within `ms`. Some storage
 * backends stall instead of failing (a wedged OPFS lock, a fetch that never
 * settles), and an unanswered worker is indistinguishable from a slow one —
 * so a ceiling is what keeps "opening" from meaning "forever".
 */
function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clear = () => {
    if (timer !== undefined) clearTimeout(timer);
  };
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms}ms`)), ms);
  });
  // `Promise.race` subscribes to both branches, so a late-settling loser can
  // never surface as an unhandled rejection.
  return Promise.race([
    promise.then(
      (value) => {
        clear();
        return value;
      },
      (error: unknown) => {
        clear();
        throw error;
      },
    ),
    timeout,
  ]);
}

function post(message: WorkerResponse) {
  ctx.postMessage(message);
}

function requireDatabase(): SqliteHandle {
  if (!database) throw new Error("The local database has not finished opening yet.");
  return database;
}

function readUserVersion(handle: SqliteHandle): number {
  const statement = handle.prepare("PRAGMA user_version");
  try {
    const [value] = statement.step() ? statement.get([]) : [];
    return typeof value === "number" ? value : Number(value ?? 0);
  } finally {
    statement.finalize();
  }
}

/**
 * Explicit BEGIN/COMMIT rather than `handle.transaction()`: it keeps the
 * dependency between the body and the handle visible, and gives the rollback a
 * single obvious home.
 */
function runInTransaction(handle: SqliteHandle, work: () => void) {
  handle.exec("BEGIN IMMEDIATE");
  try {
    work();
    handle.exec("COMMIT");
  } catch (error) {
    handle.exec("ROLLBACK");
    throw error;
  }
}

/**
 * Applies every migration the database has not seen yet, in a single
 * transaction, then stamps `user_version`. Migrations are append-only, so a
 * database created today keeps working as more are added.
 */
function migrate(handle: SqliteHandle) {
  const from = readUserVersion(handle);
  if (from >= SCHEMA_VERSION) return;

  // Foreign keys must be OFF for the whole of a table rebuild. Migration 4 drops
  // and recreates `accounts`, and `transactions.account_id` is ON DELETE CASCADE —
  // with FKs enforced, that DROP would delete every transaction the user has.
  //
  // The pragma is a no-op inside a transaction, so this is toggled *around*
  // runInTransaction rather than within it. `foreign_key_check` afterwards turns
  // "the rebuild silently broke a reference" into a loud failure.
  handle.exec("PRAGMA foreign_keys = OFF");

  try {
    runInTransaction(handle, () => {
      for (let version = from; version < SCHEMA_VERSION; version++) {
        const steps = MIGRATIONS[version];
        if (!steps) throw new Error(`No migration registered for schema version ${version}`);
        for (const sql of steps) handle.exec(sql);
      }
      // PRAGMA arguments cannot be bound, and SCHEMA_VERSION is a checked-in
      // integer constant — never user input.
      handle.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    });
  } finally {
    handle.exec("PRAGMA foreign_keys = ON");
  }

  // A rebuild that lost a reference would otherwise pass silently and surface
  // much later as a mysteriously empty transaction list.
  const violations = handle.prepare("PRAGMA foreign_key_check");
  try {
    if (violations.step()) {
      throw new Error(
        "Migration left broken references in the database. Nothing was committed incorrectly, but this database needs to be recreated.",
      );
    }
  } finally {
    violations.finalize();
  }
}

function runQuery(statement: Statement): QueryResult {
  const prepared = requireDatabase().prepare(statement.sql);
  try {
    if (statement.bind?.length) prepared.bind([...statement.bind]);

    const columns = prepared.getColumnNames();
    // `step()` is what actually executes the statement. For a write it returns
    // false straight away, so this one path serves reads and writes alike.
    const rows: unknown[][] = [];
    while (prepared.step()) rows.push(prepared.get([]));

    return { columns, rows };
  } finally {
    prepared.finalize();
  }
}

function runBatch(statements: readonly Statement[]): QueryResult {
  const handle = requireDatabase();

  runInTransaction(handle, () => {
    for (const statement of statements) {
      const prepared = handle.prepare(statement.sql);
      try {
        if (statement.bind?.length) prepared.bind([...statement.bind]);
        prepared.step();
      } finally {
        prepared.finalize();
      }
    }
  });

  return { columns: [], rows: [] };
}

function toWorkerError(error: unknown): WorkerError {
  if (error && typeof error === "object") {
    const candidate = error as { message?: unknown; resultCode?: unknown };
    return {
      message:
        typeof candidate.message === "string" ? candidate.message : "Unspecified SQLite failure",
      code: typeof candidate.resultCode === "number" ? candidate.resultCode : undefined,
    };
  }
  return { message: String(error) };
}

async function boot() {
  const sqlite3 = await withTimeout(
    sqlite3InitModule({ locateFile: () => "/sqlite3.wasm" }),
    ENGINE_LOAD_TIMEOUT_MS,
    "Loading the SQLite engine",
  );

  let storage: WorkerStorage = "memory";
  let reason: string | undefined;
  let handle: SqliteHandle;

  try {
    const pool = await withTimeout(
      sqlite3.installOpfsSAHPoolVfs({
        name: VFS_NAME,
        directory: VFS_DIRECTORY,
        // One database plus its journal. The pool preallocates and keeps a file
        // handle open per slot, so this deliberately stays tight.
        initialCapacity: 2,
      }),
      OPFS_OPEN_TIMEOUT_MS,
      "Opening the on-device database file",
    );
    handle = new pool.OpfsSAHPoolDb(DATABASE_FILE) as unknown as SqliteHandle;
    storage = "opfs";
  } catch (error) {
    // Private-browsing modes and older Safari will not hand over OPFS, and a
    // wedged file lock can stall the open past the timeout instead of failing.
    // A transient database keeps the app fully usable; the UI surfaces that it
    // will not survive a reload rather than failing silently.
    reason = error instanceof Error ? error.message : String(error);
    // Logged only after the fall back is known-good, and behind the flag below,
    // so the worker's first console call never happens at module scope.
    safeLog("warn", "[local-db] OPFS unavailable, using memory:", reason);
    handle = new sqlite3.oo1.DB(DATABASE_FILE, "ct") as unknown as SqliteHandle;
    storage = "memory";
  }

  for (const pragma of CONNECTION_PRAGMAS) handle.exec(pragma);

  migrate(handle);
  database = handle;

  // Past this point a failure cannot leave the worker mute: the handle exists and
  // the main thread has already been told the module evaluated.
  WORKER_CONSOLE_SAFE = true;

  post({ kind: "ready", storage, reason });
}

/**
 * Deletes every user row, then rebuilds the schema from empty.
 *
 * `DROP TABLE` rather than `DELETE FROM`: the latter leaves the file grown and
 * does not release anything a previous interrupted open may still be holding on
 * the OPFS sync handle. Foreign keys are off for the duration so the drops do
 * not cascade in an order that fights itself.
 */
function resetDatabase(conn: SqliteHandle): void {
  const tables = [
    // Children first, so no drop ever triggers a cascade that would run into a
    // table that has already gone.
    "goal_recommendations",
    "financial_goals",
    "budget_items",
    "budgets",
    // Before `recurring_transactions`: occurrences reference accounts and
    // categories, and before `transactions` so nothing cascades into a table
    // that has already gone.
    "planned_occurrences",
    "recurring_transactions",
    "sync_state",
    "outbox",
    "transactions",
    "categories",
    "category_groups",
    "accounts",
    "profiles",
  ];

  database = null;
  conn.exec("PRAGMA foreign_keys = OFF");
  try {
    for (const table of tables) conn.exec(`DROP TABLE IF EXISTS ${table}`);
    // Re-stamping from 0 replays every migration, which recreates the schema.
    conn.exec("PRAGMA user_version = 0");
    migrate(conn);
  } finally {
    conn.exec("PRAGMA foreign_keys = ON");
  }
}

ctx.addEventListener("message", (event) => {
  const request = event.data;
  if (!request || typeof request.id !== "number") return;

  try {
    if (!database) throw new Error("The local database has not finished opening yet.");

    if (request.kind === "exec") {
      database.exec(request.sql);
      post({ id: request.id, ok: true, result: { columns: [], rows: [] } });
      return;
    }

    if (request.kind === "reset") {
      const conn = requireDatabase();
      resetDatabase(conn);
      post({ id: request.id, ok: true, result: { columns: [], rows: [] } });
      return;
    }

    const result = request.kind === "query" ? runQuery(request.stmt) : runBatch(request.statements);

    post({ id: request.id, ok: true, result });
  } catch (error) {
    post({ id: request.id, ok: false, error: toWorkerError(error) });
  }
});

boot().catch((error: unknown) => {
  // Report first, log second. A log that throws would otherwise skip the `post`
  // below and leave the main thread waiting out its timeout for nothing.
  post({
    kind: "ready",
    storage: "unavailable",
    reason: error instanceof Error ? error.message : String(error),
  });
  safeLog("error", "[local-db] failed to start:", error);
});
