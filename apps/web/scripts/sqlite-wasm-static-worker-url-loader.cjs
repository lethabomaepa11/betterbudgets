// Turbopack loader that gives SQLite's amalgamated ESM build a *static* worker
// specifier.
//
// `@sqlite.org/sqlite-wasm` publishes one bundled module that also contains
// SQLite's deprecated Worker1 promiser. That promiser spawns its
// OPFS-async-proxy worker from a computed URL:
//
//     new Worker(new URL(proxyUri, import.meta.url))
//
// `proxyUri` is `options.proxyUri + <query string>`, and `options.proxyUri`
// already defaults to `"sqlite3-opfs-async-proxy.js"`. Substituting that literal
// preserves the runtime behaviour exactly while giving the bundler something it
// can resolve and emit as an asset — a computed specifier is unresolvable by
// definition, which otherwise fails the whole build.
//
// This app never uses the promiser (see `src/lib/local-db/worker.ts`), so the
// only real requirement is that this module stops breaking the build.
const DYNAMIC_WORKER_URL = /new Worker\(new URL\(proxyUri, import\.meta\.url\)\)/g;
const STATIC_WORKER_URL = 'new Worker(new URL("sqlite3-opfs-async-proxy.js", import.meta.url))';

module.exports = function sqliteWasmStaticWorkerUrlLoader(source) {
  if (!DYNAMIC_WORKER_URL.test(source)) return source;
  DYNAMIC_WORKER_URL.lastIndex = 0;
  return source.replace(DYNAMIC_WORKER_URL, STATIC_WORKER_URL);
};
