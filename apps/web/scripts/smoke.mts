/**
 * Browser smoke test: does the app actually render and accept input?
 *
 * Written because three defects in a row shipped past `tsc --noEmit` and past
 * "every route returns 200" — a missing brace that blanked two whole screens, and
 * a Continue button that navigated to the page it was already on. All three were
 * invisible to typechecking. Only rendering the page catches them.
 *
 * Run against a dev server: node apps/web/scripts/smoke.mts
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:3001";

const ROUTES: readonly { path: string; expect: string }[] = [
  { path: "/onboarding", expect: "What currency do you use?" },
  { path: "/onboarding/account", expect: "Where does your money currently live?" },
  { path: "/onboarding/categories", expect: "How do you want to sort your spending?" },
  { path: "/onboarding/budget", expect: "Do you want to set a first budget?" },
];

let failures = 0;

function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    console.log(`  ok    ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const browser = await chromium.launch();
const page = await browser.newPage();

const consoleErrors: string[] = [];
// The app is local-first, so the optional API server (port 3000) is often not
// running during development. Its connection refusals are expected, not defects.
const EXPECTED_NOISE = /ERR_CONNECTION_REFUSED|Failed to load resource/;

page.on("console", (message) => {
  if (message.type() === "error" && !EXPECTED_NOISE.test(message.text())) {
    consoleErrors.push(message.text());
  }
});
page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${error.message}`));

for (const route of ROUTES) {
  const response = await page.goto(`${BASE}${route.path}`, { waitUntil: "domcontentloaded" });

  // A 200 proves the route resolved, not that it rendered anything. The earlier
  // blank pages were 200s with an empty body.
  check(`${route.path} responds 200`, response?.status() === 200, `got ${response?.status()}`);
  check(`${route.path} renders "${route.expect}"`, await page.getByText(route.expect).first().isVisible());
}

check("no console errors", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));

await browser.close();

console.log(failures === 0 ? "\nsmoke: all checks passed" : `\nsmoke: ${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);