/**
 * Runs the pure-logic unit tests without a test framework or a bundler.
 *
 * The project has no test runner, and these tests are deliberately free of any
 * Next-only imports so they can execute on bare Node. Node's type stripping
 * handles the syntax; the only thing it cannot do is resolve the `@/` path
 * alias, so the harness stages a copy with those imports replaced by local type
 * declarations.
 *
 * Keeping this dependency-free is a hard constraint, not a convenience: it is
 * what makes date and routing logic testable at all. The alternative is the
 * state this project was in, where a blank screen and a dead button both shipped
 * past `tsc --noEmit` and a route returning 200.
 *
 * Run: node --experimental-strip-types apps/web/scripts/run-unit-tests.mts
 */
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * `fileURLToPath`, not `.pathname`: the checkout path contains a space
 * ("production projects"), and a URL-encoded pathname comes back with `%20`
 * still in it, pointing at a directory that does not exist.
 */
const LIB_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "lib");

/** Stands in for the types a test would otherwise import across the alias. */
const STUB_TYPES = [
  'type RecurringFrequency = "daily" | "weekly" | "monthly" | "yearly";',
  'type MonthlyAnchor = "day_of_month" | "first_weekday" | "last_weekday" | "last_day";',
  'type RecurrenceRule = { frequency: RecurringFrequency; anchor: MonthlyAnchor; dayOfMonth: number };',
  'type OnboardingStep =',
  '  | "currency" | "purpose" | "account" | "categories" | "budget" | "done";',
].join("\n");

/**
 * Rewrites the specifiers bare Node cannot resolve: the `@/` path alias (a
 * Next/Turbopack convention) and explicit `.ts` extensions.
 *
 * Only *type* imports are stubbed. A value import from `@/` would need the real
 * module graph, which is the bundler's job, so it is reported rather than
 * silently blanked -- swapping in an empty module would turn a real failure into
 * a confusing "x is not a function" much further down.
 */
function stage(source: string): string {
  const valueImports = source.match(/^import \{[^}]*\} from "@\/[^"]*";$/gm);
  if (valueImports) {
    throw new Error(
      `unit tests must not import values from "@/": ${valueImports.join(", ")} ` +
        "- move the logic under test into a dependency-free module",
    );
  }

  return source
    .replace(/^import type \{[^}]*\} from "@\/[^"]*";$/gm, STUB_TYPES)
    .replace(/^import type \{[^}]*\} from "\.\/schema\.ts";$/gm, "")
    .replace(/from "\.\/([A-Za-z0-9_-]+)\.ts"/g, 'from "./$1.mts"')
    .replace(/from "\.\/([A-Za-z0-9_-]+)"/g, 'from "./$1.mts"');
}

/** Every `.ts` under `src/lib`, as paths relative to it. */
function walk(dir: string, prefix = ""): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const relative = prefix ? `${prefix}${sep}${entry.name}` : entry.name;
    if (entry.isDirectory()) return walk(join(dir, entry.name), relative);
    return entry.name.endsWith(".ts") ? [relative] : [];
  });
}

const stageDir = mkdtempSync(join(tmpdir(), "bb-tests-"));

const all = walk(LIB_DIR);
const tests = all.filter((name) => name.endsWith(".test.ts")).map((name) => name.replace(/\.test\.ts$/, ""));

if (tests.length === 0) {
  console.error("no *.test.ts files found under src/lib");
  process.exit(1);
}

/** Stage the dependency-free graph first, then the tests that import it. */
function stageAll(names: readonly string[]) {
  for (const name of names) {
    // Swap the extension rather than appending: `stage()` rewrites sibling
    // imports to `./name.mts`, so writing `name.ts.mts` would leave every one of
    // those imports dangling.
    const target = join(stageDir, name.replace(/\.ts$/, ".mts"));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, stage(readFileSync(join(LIB_DIR, name), "utf8")), "utf8");
  }
}

stageAll(all.filter((name) => !name.endsWith(".test.ts")));
stageAll(tests.map((name) => `${name}.test.ts`));

let failed = 0;

for (const name of tests) {
  console.log(`\n${name}`);
  try {
    const module = await import(pathToFileURL(join(stageDir, `${name}.test.mts`)).href);
  } catch (cause) {
    failed += 1;
    const detail = cause instanceof Error ? cause.message : String(cause);
    console.log(`  FAIL  ${name} - ${detail.split("\n")[0]}`);
  }
}

rmSync(stageDir, { recursive: true, force: true });

console.log(failed === 0 ? "\nall suites passed" : `\n${failed} suite(s) failed`);
process.exit(failed === 0 ? 0 : 1);