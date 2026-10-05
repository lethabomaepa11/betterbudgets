// Wire format between the main thread and the SQLite worker.
//
// The worker owns the only handle to the database, so every read and write
// crosses this boundary. Requests are plain data (no functions) because
// `postMessage` structured-clones them.

export type SqlValue = string | number | null | Uint8Array;

/** A single statement plus its positional bindings. */
export type Statement = {
  sql: string;
  bind?: readonly SqlValue[];
};

export type WorkerRequestPayload =
  /** Multi-statement SQL with no bindings — used for migrations and pragmas. */
  | { kind: "exec"; sql: string }
  /** One statement, bindings allowed. Resolves to tabular results. */
  | { kind: "query"; stmt: Statement }
  /** Several statements applied inside a single transaction. */
  | { kind: "batch"; statements: readonly Statement[] }
  /**
   * Drops every user row and re-applies migrations from empty. Reserved for an
   * explicit "clear my data" action: it is irreversible, so the UI must confirm
   * first rather than offering it as a repair step.
   */
  | { kind: "reset" };

export type WorkerRequest = WorkerRequestPayload & { id: number };

export type QueryResult = {
  /** Column names, in order. Empty for statements that return no rows. */
  columns: string[];
  /** Row-major values, aligned with `columns`. */
  rows: unknown[][];
};

export type WorkerError = {
  message: string;
  /** `SQLite3Error` result code when the failure came from SQLite itself. */
  code?: number;
};

export type WorkerResponse =
  | { id: number; ok: true; result: QueryResult }
  | { id: number; ok: false; error: WorkerError }
  /** Emitted once after the database is open, before any request settles. */
  | { kind: "ready"; storage: WorkerStorage; reason?: string }
  /**
   * Sent the moment the worker module finishes evaluating, before it opens the
   * database. Purely diagnostic: it distinguishes "the worker never ran" from
   * "the worker ran and the open failed", which look identical from the main
   * thread because a module-eval throw never reaches `onerror` here.
   */
  | { kind: "evaluating" };

export type WorkerStorage = "opfs" | "memory" | "unavailable";
