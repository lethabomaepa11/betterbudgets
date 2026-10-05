/**
 * End-to-end acceptance cases for the primary web user journey.
 *
 * Run against a web dev server:
 *   node --experimental-strip-types apps/web/scripts/e2e-acceptance.mts
 *
 * Cases:
 * 1. Public entry points render useful content.
 * 2. A new user can create a local profile and finish onboarding.
 * 3. Protected ledger routes render after onboarding.
 * 4. Mobile users can open and dismiss the transaction chooser.
 * 5. Transfer and mobile-download entry points are reachable.
 */
import { chromium, type Page } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:3001";
let failures = 0;

function check(name: string, condition: boolean, detail = "") {
  if (condition) {
    console.log(`  ok    ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${name}${detail ? ` - ${detail}` : ""}`);
  }
}

async function visibleText(page: Page, timeout = 15_000) {
  await page.waitForFunction(
    () => Boolean(document.body?.innerText.trim()),
    undefined,
    { timeout },
  );
  return page.locator("body").innerText();
}

async function waitForCopy(page: Page, copy: string) {
  try {
    await page.waitForFunction(
      (expected) => document.body?.innerText.includes(expected),
      copy,
      { timeout: 20_000 },
    );
  } catch {
    const body = await page.locator("body").innerText();
    console.log(`  note  timed out waiting for "${copy}": ${body.slice(0, 180)}`);
    return body;
  }
  return page.locator("body").innerText();
}

async function createProfile(page: Page) {
  await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
  const name = page.getByRole("textbox", { name: "What should we call you?" });
  await name.waitFor({ state: "visible", timeout: 20_000 });
  await name.fill("Acceptance Tester");
  await page.getByRole("button", { name: /^Continue$/ }).click();

  const passwordOption = page.getByRole("button", { name: /Password Anything you like/i });
  await passwordOption.click();
  await page.getByRole("textbox", { name: "Password" }).fill("acceptance-password");
  await page.getByRole("textbox", { name: "Confirm it" }).fill("acceptance-password");
  await page.getByRole("button", { name: /Create my profile/i }).click();

  await page.waitForTimeout(1_500);
  for (let step = 0; step < 8 && page.url().includes("/onboarding"); step += 1) {
    const skip = page.getByRole("button", { name: /Skip for now|do this later/i }).first();
    if (await skip.isVisible().catch(() => false)) {
      await skip.click();
    } else {
      const next = page.getByRole("button", { name: /Continue|Next|Finish/i }).first();
      if (!(await next.isVisible().catch(() => false))) break;
      await next.click();
    }
    await page.waitForTimeout(500);
  }
}

async function unlockIfNeeded(page: Page) {
  const password = page.getByRole("textbox", { name: "Password" });
  if (!(await password.isVisible().catch(() => false))) return;
  await password.fill("acceptance-password");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.waitForFunction(
    () => !document.body?.innerText.includes("Your budget is locked."),
    undefined,
    { timeout: 15_000 },
  );
}

const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();
const consoleErrors: string[] = [];
page.on("console", (message) => {
  if (message.type() === "error" && !/ERR_CONNECTION_REFUSED|Failed to load resource/i.test(message.text())) {
    consoleErrors.push(message.text());
  }
});
page.on("pageerror", (error) => consoleErrors.push(error.message));

console.log("Case 1: public entry points");
for (const [path, expected] of [
  ["/", "Budgeting that keeps working"],
  ["/download", "Take betterbudgets with you"],
] as const) {
  const response = await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
  const body = await waitForCopy(page, expected);
  check(`${path} responds successfully`, response?.status() === 200, `got ${response?.status()}`);
  check(`${path} renders its content`, body.includes(expected), body.slice(0, 120));
}

console.log("Case 2: create profile and finish onboarding");
await createProfile(page);
check("profile creation leaves onboarding", !page.url().includes("/onboarding"), page.url());
check(
  "dashboard is visible after onboarding",
  (await waitForCopy(page, "across every account")).includes("across every account"),
);

const transferResponse = await page.goto(`${BASE}/transfer`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2_000);
await unlockIfNeeded(page);
const transferBody = await waitForCopy(page, "Receive your budget");
check("transfer responds successfully", transferResponse?.status() === 200);
check("transfer receiver renders", transferBody.includes("Receive your budget"));

console.log("Case 3: protected ledger routes");
for (const [path, expected] of [
  ["/accounts", "Where your money is"],
  ["/activity", "Activity"],
  ["/budgets", "Budgets"],
  ["/goals", "Plans"],
  ["/recurring", "Repeating money"],
  ["/settings", "Settings"],
  ["/upcoming", "Upcoming payments"],
] as const) {
  const response = await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1_000);
  await unlockIfNeeded(page);
  const body = await waitForCopy(page, expected);
  check(`${path} responds successfully`, response?.status() === 200, `got ${response?.status()}`);
  check(`${path} renders its content`, body.includes(expected), body.slice(0, 120));
}

console.log("Case 4: mobile transaction chooser");
const small = await context.newPage();
await small.setViewportSize({ width: 390, height: 844 });
await small.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
await small.waitForTimeout(1_000);
await unlockIfNeeded(small);
const add = small.locator('nav[aria-label="Primary"] button[aria-haspopup="dialog"]');
let mobileReady = true;
try {
  await add.waitFor({ state: "visible", timeout: 15_000 });
} catch {
  mobileReady = false;
  check("mobile dashboard exposes the primary action", false, (await small.locator("body").innerText()).slice(0, 180));
}
if (mobileReady) {
  await add.click();
  const chooser = small.locator('[role="dialog"][aria-labelledby="add-transaction-title"]');
  await chooser.waitFor({ state: "visible" });
  check("chooser offers one-off transaction", await chooser.getByText("Just this once").isVisible());
  check("chooser offers recurring transaction", await chooser.getByText("Every month").isVisible());
  await small.keyboard.press("Escape");
  await chooser.waitFor({ state: "detached" });
  check("Escape dismisses transaction chooser", (await chooser.count()) === 0);
}

console.log("Case 5: no uncaught browser errors");
check("browser console is clean", consoleErrors.length === 0, consoleErrors.slice(0, 2).join(" | "));

await small.close();
await context.close();
await browser.close();
console.log(failures === 0 ? "\ne2e acceptance: all cases passed" : `\ne2e acceptance: ${failures} case(s) failed`);
process.exit(failures === 0 ? 0 : 1);
