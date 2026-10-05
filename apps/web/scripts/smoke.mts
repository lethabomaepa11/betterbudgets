/**
 * Browser smoke test: does the app actually render?
 *
 * Written because three defects in a row shipped past `tsc --noEmit` and past
 * "every route returns 200" â€” a missing brace that blanked two whole screens, and
 * a Continue button that navigated to the page it was already on. None of them
 * were visible to typechecking, and the 200s were real: the routes resolved, the
 * pages rendered nothing.
 *
 * Run against a dev server: node --experimental-strip-types apps/web/scripts/smoke.mts
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:3001";

/**
 * Each route plus a pattern that only appears on it if it actually rendered.
 *
 * Patterns are built from literals rather than written inline, because the copy is
 * full of "?" and a literal `/What currency do you use?/` means "u" followed by an
 * optional "e" - it matches the wrong thing and would pass on a blank page.
 */
function renders(...words: readonly string[]): RegExp {
  return new RegExp(words.join(".*"), "s");
}

const ROUTES: readonly { path: string; expect: RegExp }[] = [
  { path: "/onboarding", expect: renders("What currency do you use?") },
  { path: "/onboarding/account", expect: renders("Where does your money currently live?") },
  { path: "/onboarding/categories", expect: renders("How do you want to sort your spending?") },
  { path: "/onboarding/budget", expect: renders("Do you want to set a first budget?") },
  { path: "/recurring/new", expect: renders("Set up repeating money") },
  { path: "/recurring", expect: renders("Repeating money") },
  { path: "/more", expect: renders("More", "Accounts", "Settings") },
  // The dashboard and everything behind the gate redirect to profile creation when
  // this browser has no profile yet, so the sign-in screen is the correct thing to
  // be here. Asserting on the dashboard's own copy would fail on a clean profile
  // and pass on a used one - the opposite of what a test wants.
  { path: "/dashboard", expect: renders("What should we call you?") },
  // A public route, so it renders its own copy rather than redirecting.`r`n  { path: "/accounts", expect: renders("Where your money is") },
];

let failures = 0;

function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    console.log(`  ok    ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${name}${detail ? ` - ${detail}` : ""}`);
  }
}

const browser = await chromium.launch();
const page = await browser.newPage();

// The app is local-first, so the optional API server (port 3000) is often not
// running in development. Its connection refusals are expected, not defects.
const EXPECTED_NOISE = /ERR_CONNECTION_REFUSED|Failed to load resource|sharedArrayBuffer/i;

const consoleErrors: string[] = [];
page.on("console", (message) => {
  if (message.type() === "error" && !EXPECTED_NOISE.test(message.text())) {
    consoleErrors.push(message.text());
  }
});
page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${error.message}`));

for (const route of ROUTES) {
  const response = await page.goto(`${BASE}${route.path}`, { waitUntil: "domcontentloaded" });

  // A 200 proves the route resolved, not that it rendered anything.
  check(`${route.path} responds 200`, response?.status() === 200, `got ${response?.status()}`);

  // Reads the rendered text rather than using `getByText`, which matches against
  // a single element: copy that React split across a heading and a span is
  // visible to a person and invisible to a locator, which makes for a test that
  // fails on correct code.
  //
  // The wait is not optional. Everything behind the gate is behind an async
  // SQLite worker opening OPFS, so `domcontentloaded` fires while the page is
  // still showing its shell. Asserting immediately reads an empty body and
  // reports a blank page that is merely not ready yet.
  let body = "";
  try {
    await page.waitForFunction(
      (pattern) => new RegExp(pattern, "s").test(document.body.innerText),
      route.expect.source,
      { timeout: 15_000 },
    );
    body = await page.evaluate(() => document.body.innerText);
  } catch {
    body = await page.evaluate(() => document.body.innerText);
  }

  check(`${route.path} renders its content`, route.expect.test(body), body.slice(0, 80));
}

check("no uncaught console errors", consoleErrors.length === 0, consoleErrors.slice(0, 2).join(" | "));

await browser.close();

console.log(failures === 0 ? "\nsmoke: all checks passed" : `\nsmoke: ${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);

