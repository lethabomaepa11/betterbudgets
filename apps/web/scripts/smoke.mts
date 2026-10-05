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
import { chromium, type Page } from "playwright";

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
  // This protected route shows the edit fallback when a profile is unlocked,
  // and the sign-in gate in a clean browser. Both are valid outcomes.
  { path: "/recurring/not-a-real-id/edit", expect: /Edit this one|Sign In/s },
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

/**
 * The centre button's chooser, exercised for real.
 *
 * This is the one flow that cannot be checked by looking at a URL: the button
 * opens a dialog rather than navigating, so a route test sees nothing at all. It
 * also needs a phone viewport, because the bar is `md:hidden` and at desktop
 * width the button does not exist.
 */
const mobile = await browser.newContext({
  viewport: { width: 390, height: 844 },
  // Shares the first context's storage, so the OPFS database is unlocked here too
  // and the tab bar is actually present to press.
  storageState: await browser.contexts()[0]!.storageState(),
});
const small = await mobile.newPage();

await small.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });

/**
 * Gets past the vault gate so there is a tab bar to press.
 *
 * `BottomNav` renders only while the vault is unlocked, so on a clean browser
 * there is no bar at all. Walking the real profile-creation flow is the only way
 * to reach the button in a test; a stubbed unlock would not exercise the same
 * code path a user does.
 */
async function unlockVault(target: Page) {
  // The form only exists once the SQLite worker has opened OPFS, which takes a
  // moment. Checking immediately returns "no profile" and gives up before the
  // gate has even rendered, so this waits for the field to appear.
  const nameField = target.locator("#profile-name");
  const appeared = await nameField
    .waitFor({ state: "visible", timeout: 20_000 })
    .then(() => true)
    .catch(() => false);
  if (!appeared) return false;

  await nameField.fill("Smoke Test");

  // Three screens, not one: name -> how you want to unlock -> the secret itself.
  // Pressing Continue on the name screen only advances to the method screen, so
  // each step has to be walked in turn.
  await target.getByRole("button", { name: /^Continue$/ }).first().click();
  await target.waitForTimeout(400);

  const pinOption = target.getByRole("button", { name: /pin/i }).first();
  if (await pinOption.isVisible().catch(() => false)) await pinOption.click();
  await target.waitForTimeout(400);

  // The PIN screen is a keypad, not a text field: there is no `<input>` to fill.
  // Five digits, because that is what the screen asks for and the Create button
  // stays disabled until exactly that many are in.
  for (const digit of ["1", "2", "3", "4", "5"]) {
    await target.getByRole("button", { name: digit, exact: true }).first().click();
    await target.waitForTimeout(100);
  }

  const confirm = target.getByRole("button", { name: /create my profile/i }).first();
  const ready = await confirm
    .waitFor({ state: "visible", timeout: 5000 })
    .then(() => confirm.isEnabled())
    .catch(() => false);
  if (ready) await confirm.click();
  await target.waitForTimeout(3000);

  // Onboarding follows, and every step is skippable.
  for (let step = 0; step < 6; step += 1) {
    if (!target.url().includes("/onboarding")) break;
    const skip = target.getByRole("button", { name: /skip for now/i }).first();
    if (await skip.isVisible().catch(() => false)) {
      await skip.click();
    } else {
      const next = target.getByRole("button", { name: /continue|next|finish/i }).first();
      if (!(await next.isVisible().catch(() => false))) break;
      await next.click();
    }
    await target.waitForTimeout(1200);
  }
  return true;
}

const unlocked = await unlockVault(small);
if (!unlocked) {
  console.log("  note  no profile form found; assuming the vault is already unlocked");
}

// Wait out the gate: until the profile is unlocked there is no bar to press.
await small
  .waitForSelector('nav[aria-label="Primary"] button[aria-haspopup="dialog"]', { timeout: 20_000 })
  .catch(() => {});

const addButton = small.locator('nav[aria-label="Primary"] button[aria-haspopup="dialog"]');

// BottomNav renders only while the vault is unlocked, so with no profile in this
// browser there is genuinely no bar to press. Reported rather than asserted: the
// chooser cannot be reached without a profile, and failing the whole run on that
// would make this check useless on a clean machine.
const barPresent = (await addButton.count()) === 1;
check(
  "the tab bar renders on a phone viewport once the vault is unlocked",
  barPresent,
  "no unlocked profile, so BottomNav correctly renders nothing",
);

if (barPresent) {
  check("the centre button is a button, not a link", (await addButton.count()) === 1);
  check(
    "it is labelled for screen readers",
    (await addButton.getAttribute("aria-label")) === "Add a transaction",
  );

  await addButton.click();

  // The question, asked before any form is shown.
  const dialog = small.locator('[role="dialog"][aria-labelledby="add-transaction-title"]');
  await small.waitForSelector('[role="dialog"][aria-labelledby="add-transaction-title"]', {
    timeout: 5_000,
  });
  check("pressing it asks which kind of transaction", (await dialog.count()) === 1);
  check(
    "one-off is offered",
    await dialog.getByText("Just this once").isVisible().catch(() => false),
  );
  check(
    "recurring is offered",
    await dialog.getByText("Every month").isVisible().catch(() => false),
  );
  check("it has not navigated anywhere yet", !small.url().includes("/transactions/new"), small.url());

  // Escape closes it, and closing must not leave the user anywhere new.
  await small.keyboard.press("Escape");
  await small.waitForSelector('[role="dialog"][aria-labelledby="add-transaction-title"]', {
    state: "detached",
    timeout: 5_000,
  });
  check("Escape closes the chooser", (await dialog.count()) === 0);
  check("and stays put", !small.url().includes("/transactions/new"), small.url());

  // Reopening and choosing must actually navigate to that choice.
  await addButton.click();
  await dialog.getByText("Every month").click();
  await small.waitForTimeout(2000);
  check("choosing recurring goes to the repeating form", small.url().includes("/recurring/new"), small.url());
} else {
  console.log("  note  skipped the chooser checks: this browser has no unlocked profile");
}

await mobile.close();
await browser.close();

console.log(failures === 0 ? "\nsmoke: all checks passed" : `\nsmoke: ${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
