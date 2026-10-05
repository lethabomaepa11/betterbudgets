// Copies the SQLite WASM binary out of node_modules into `public/` so it is
// served from a stable, cacheable URL.
//
// Why a copy instead of resolving it through the bundler: the Emscripten loader
// looks for the binary next to its own module via
// `new URL("sqlite3.wasm", import.meta.url)`. That works, but it makes the WASM
// URL an implementation detail of a node_modules layout, which is awkward to
// reason about and to cache. Pointing `locateFile` at `/sqlite3.wasm` instead
// keeps the binary a first-class public asset.
//
// Wired into the `build` and `dev:bare` scripts, so it always runs first.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const pkgPath = require.resolve("@sqlite.org/sqlite-wasm/package.json");
const source = join(dirname(pkgPath), "dist", "sqlite3.wasm");

if (!existsSync(source)) {
  throw new Error(`SQLite WASM binary missing at ${source} — run \`pnpm install\` first.`);
}

const publicDir = join(scriptDir, "..", "public");
mkdirSync(publicDir, { recursive: true });

copyFileSync(source, join(publicDir, "sqlite3.wasm"));
console.log("[local-db] public/sqlite3.wasm up to date");
