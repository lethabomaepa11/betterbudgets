// Main-thread facade over the SQLite worker.
//
// The worker is created lazily and owned by exactly one `LocalDb` instance, which
// the React provider hands to the tree. Everything here is therefore safe to
// `await` from components: ordering is preserved per request, and calls made
// before the database finishes opening wait for it rather than racing it.
import type {
  QueryResult,
  Statement,
  SqlValue,
  WorkerRequestPayload,
  WorkerResponse,
  WorkerStorage,
} from "./protocol";

export type LocalDbState =
  | { status: "ready"; storage: WorkerStorage }
  | { status: "unavailable"; reason: string };

type Pending = {
  resolve: (result: QueryResult) => void;
  reject: (error: Error) => void;
};

/** Turns a column-major result into objects keyed by column name. */
function toObjects<T>({ columns, rows }: QueryResult): T[] {
  return rows.map((row) => {
    const record: Record<string, unknown> = {};
    for (let index = 0; index < columns.length; index++) {
      record[columns[index]!] = row[index];
    }
    return record as T;
  });
}

export class LocalDb {
  readonly #worker: Worker;
  readonly #pending = new Map<number, Pending>();
  readonly #state: Promise<LocalDbState>;
  #resolveState!: (state: LocalDbState) => void;
  #sequence = 0;
  #disposed = false;
  /**
   * How far the boot actually got. Surfaced on the error card because a Worker
   * that dies during evaluation is otherwise indistinguishable from one that is
   * merely slow — no message, no `error` event, nothing in the console.
   */
  #lastPhase = "created";

  constructor() {
    this.#worker = new Worker(new URL("./worker.ts", import.meta.url), {
      type: "module",
      name: "betterbudgets-sqlite",
    });

    this.#state = new Promise<LocalDbState>((resolve) => {
      this.#resolveState = resolve;
    });

    this.#worker.addEventListener("message", (event: MessageEvent<WorkerResponse>) => {
      this.#onMessage(event.data);
    });

    this.#worker.addEventListener("error", (event) => {
      const reason = event.message || "The SQLite worker stopped unexpectedly.";
      // Surface the event: a worker whose script never loads reports here
      // with an often-empty `message`, which is otherwise impossible to tell
      // apart from a slow boot.
      console.error("[local-db] worker error event:", reason, event);
      this.#resolveState({ status: "unavailable", reason });
      this.#rejectAll(new Error(reason));
    });

    // `error` covers runtime throws; `messageerror` covers a message that could
    // not be deserialised. Either way the handle is no longer safe to use.
    this.#worker.addEventListener("messageerror", () => {
      const reason = "The SQLite worker sent a message that could not be read.";
      console.error("[local-db] worker messageerror");
      this.#resolveState({ status: "unavailable", reason });
      this.#rejectAll(new Error(reason));
    });
  }

  /** Settles once the worker has opened the database, or given up trying. */
  ready(): Promise<LocalDbState> {
    return this.#state;
  }

  /** Where the boot got to. For diagnostics only; see `#lastPhase`. */
  get lastPhase(): string {
    return this.#lastPhase;
  }

  /** Runs one statement and maps the rows onto `T`. */
  async query<T>(sql: string, bind?: readonly SqlValue[]): Promise<T[]> {
    return toObjects<T>(await this.#send({ kind: "query", stmt: { sql, bind } }));
  }

  /** Runs several statements atomically. */
  async batch(statements: readonly Statement[]): Promise<void> {
    await this.#send({ kind: "batch", statements });
  }

  /**
   * Erases every local row and rebuilds the schema. Irreversible.
   *
   * Lives here rather than in a repository because it is a transport-level
   * command: there is no SQL that can express "forget everything and start the
   * migrations again". Callers must confirm with the user first.
   */
  async reset(): Promise<void> {
    await this.#send({ kind: "reset" });
  }

  /** Terminates the worker. Every in-flight request rejects. */
  dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#worker.terminate();
    this.#rejectAll(new Error("The local database was closed."));
    // Awaiters of `ready()` must also be released — otherwise a component that
    // asked "are we open yet?" waits forever on a terminated worker.
    // Resolving twice is a no-op, so this is safe even after a normal boot.
    this.#resolveState({ status: "unavailable", reason: "The local database was closed." });
  }

  async #send(request: WorkerRequestPayload): Promise<QueryResult> {
    if (this.#disposed) throw new Error("The local database has been closed.");

    // Waiting here — rather than letting the worker reject a request that
    // arrived before `boot()` finished — is what makes the first render safe to
    // query straight away. Note the `await` below: disposal may happen while
    // this request is parked, so the check is repeated afterwards. Without the
    // second check, a request parked here registers in `#pending` *after*
    // `dispose()` has already swept it, and then waits forever.
    const state = await this.#state;
    if (this.#disposed) throw new Error("The local database has been closed.");
    if (state.status !== "ready") throw new Error(state.reason);

    const id = ++this.#sequence;
    return new Promise<QueryResult>((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#worker.postMessage({ ...request, id });
    });
  }

  #onMessage(message: WorkerResponse) {
    // The evaluation heartbeat carries no `id`, so it is ignored by the pending
    // map below and never resolves a request.
    if ("kind" in message) {
      if (message.kind === "evaluating") {
        this.#lastPhase = "evaluating";
        return;
      }
      this.#lastPhase = message.storage === "unavailable" ? "failed" : "ready";
      this.#resolveState(
        message.storage === "unavailable"
          ? {
              status: "unavailable",
              reason: message.reason ?? "SQLite could not be opened.",
            }
          : { status: "ready", storage: message.storage },
      );
      return;
    }

    const pending = this.#pending.get(message.id);
    if (!pending) return;
    this.#pending.delete(message.id);

    if (message.ok) pending.resolve(message.result);
    else pending.reject(new Error(message.error.message));
  }

  #rejectAll(error: Error) {
    for (const pending of this.#pending.values()) pending.reject(error);
    this.#pending.clear();
  }
}
