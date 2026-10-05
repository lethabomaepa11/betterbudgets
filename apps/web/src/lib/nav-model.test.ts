/**
 * Navigation rules, asserted directly.
 *
 * The tab bar is capped at five slots, and that cap is the kind of constraint
 * that erodes: each new screen looks harmless on its own, and the result is a bar
 * of six with three-character labels nobody can read. These turn that erosion into
 * a failing test rather than something a design review has to notice.
 *
 * The model is a separate module with no icon imports precisely so this is
 * possible â€” the icons are a rendering concern, and testing them would only prove
 * that lucide-react is installed.
 *
 * Run: node --experimental-strip-types apps/web/src/lib/nav-model.test.ts
 */
import assert from "node:assert/strict";

import {
  ALL_APP_ROUTES,
  MAX_NAV_SLOTS,
  MORE_SCREENS,
  NAV_CENTER,
  NAV_ITEMS,
  isActivePath,
} from "./nav-model.ts";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
  } catch (cause) {
    failed += 1;
    const detail = cause instanceof Error ? cause.message : String(cause);
    console.log(`  FAIL  ${name} - ${detail.replace(/\s+/g, " ").slice(0, 200)}`);
    return;
  }
  passed += 1;
  console.log(`  ok  ${name}`);
}

test("the tab bar is at most five slots including the action button", () => {
  assert.ok(
    NAV_ITEMS.length + 1 <= MAX_NAV_SLOTS,
    `${NAV_ITEMS.length} tabs plus the button is ${NAV_ITEMS.length + 1} slots, over the ${MAX_NAV_SLOTS} limit`,
  );
});

test("tab labels are words, not truncated fragments", () => {
  // The bar used to slice labels to three characters, turning "Activity" into
  // "Act" and "Reports" into "Rep". Short is fine; cryptic is not.
  for (const item of NAV_ITEMS) {
    assert.ok(item.label.length >= 4, `"${item.label}" reads as an abbreviation`);
    assert.equal(item.label, item.label.trim());
  }
});

test("every tab has a distinct route", () => {
  const hrefs = NAV_ITEMS.map((item) => item.href);
  assert.equal(new Set(hrefs).size, hrefs.length, "a route appears twice in the tab bar");
});

test("the action button is not also a tab", () => {
  // The button now opens a chooser rather than navigating, so the check is that
  // none of its destinations are also tabs — otherwise one of them appears twice.
  const tabs = new Set(NAV_ITEMS.map((item) => item.href));
  for (const choice of NAV_CENTER.choices) {
    assert.ok(!tabs.has(choice.href), `${choice.href} is both a tab and a button choice`);
  }
});

test("the action button offers one-off and repeating, not a single destination", () => {
  // The button used to link straight to the one-off form, which meant a monthly
  // bill had to be remembered as "recurring" somewhere else, or it was filed as a
  // single payment and quietly never came round again.
  assert.ok(NAV_CENTER.label.length > 0, "the button has no label for screen readers");

  const hrefs = NAV_CENTER.choices.map((choice) => choice.href);
  assert.ok(hrefs.includes("/transactions/new"), "no way to add a one-off");
  assert.ok(hrefs.includes("/recurring/new"), "no way to add something repeating");
});

test("each choice says what it is for", () => {
  // "Just this once" and "Every month" are not self-explanatory to everyone, and
  // a mis-filed rent payment is the expensive kind of wrong.
  for (const choice of NAV_CENTER.choices) {
    assert.ok(choice.title.length > 0, "a choice has no title");
    assert.ok(
      choice.description.trim().length > 0,
      `"${choice.title}" has no description, so it cannot be told from the other`,
    );
  }
});

test("the two choices go to different screens", () => {
  const hrefs = NAV_CENTER.choices.map((choice) => choice.href);
  assert.equal(new Set(hrefs).size, hrefs.length, "both choices lead to the same form");
});

test("More does not duplicate a tab", () => {
  const tabs = new Set(NAV_ITEMS.map((item) => item.href));
  for (const group of MORE_SCREENS) {
    for (const item of group.items) {
      assert.ok(!tabs.has(item.href), `${item.href} is both a tab and in More`);
    }
  }
});

test("every screen is reachable from the tab bar or More", () => {
  // The point of More: a screen in neither list cannot be found. This is the
  // check that would have caught the six-tab bar.
  const reachable = new Set(NAV_ITEMS.map((item) => item.href));
  for (const group of MORE_SCREENS) {
    for (const item of group.items) reachable.add(item.href);
  }

  for (const href of ALL_APP_ROUTES) {
    assert.ok(reachable.has(href), `${href} is not reachable from any navigation`);
  }
});

test("no destination is listed twice across the whole app", () => {
  const seen = new Set<string>();
  for (const item of NAV_ITEMS) {
    assert.ok(!seen.has(item.href), `${item.href} appears more than once`);
    seen.add(item.href);
  }
  for (const group of MORE_SCREENS) {
    for (const item of group.items) {
      assert.ok(!seen.has(item.href), `${item.href} appears more than once`);
      seen.add(item.href);
    }
  }
});

test("the daily tabs are the ones people open by habit", () => {
  // Guards against the list being reordered or replaced without thought: these
  // four are the app's spine, and More is the release valve for everything else.
  assert.deepEqual(
    NAV_ITEMS.map((item) => item.href),
    ["/dashboard", "/activity", "/budgets", "/more"],
  );
});

test("More is itself a tab, so nothing is two taps from the bar", () => {
  // Otherwise "More" is a screen with no way back except the browser.
  assert.ok(NAV_ITEMS.some((item) => item.href === "/more"));
});

test("every More group is titled and every row explains itself", () => {
  for (const group of MORE_SCREENS) {
    assert.ok(group.title.trim().length > 0, "a group has no title");
    assert.ok(group.items.length > 0, `the "${group.title}" group is empty`);
    for (const item of group.items) {
      assert.ok(
        item.description && item.description.trim().length > 0,
        `"${item.label}" has no description, so it cannot be told from its neighbours`,
      );
    }
  }
});

test("isActivePath matches the route and its children, not its siblings", () => {
  assert.equal(isActivePath("/dashboard", "/dashboard"), true);
  assert.equal(isActivePath("/accounts/abc", "/accounts"), true);
  assert.equal(isActivePath("/accountsx", "/accounts"), false);
  assert.equal(isActivePath("/activity", "/accounts"), false);
  assert.equal(isActivePath("/", "/"), true);
});


/**
 * The bar exactly as BottomNav assembles it: two tabs, the button, two tabs.
 *
 * Asserted rather than eyeballed because the split between `slice(0, 2)` and
 * `slice(2)` is invisible from the outside: the slots still add up correctly
 * however the list is divided, so a fifth tab would quietly push one off the end
 * and every count above would still pass.
 */
test("the assembled bar is five slots with the action button in the middle", () => {
  const bar = [
    ...NAV_ITEMS.slice(0, 2).map((item) => item.label),
    NAV_CENTER.label,
    ...NAV_ITEMS.slice(2).map((item) => item.label),
  ];

  assert.equal(bar.length, 5, `the bar renders as: ${bar.join(" | ")}`);
  assert.equal(bar[2], NAV_CENTER.label, "the action button must be the centre slot");
  assert.equal(NAV_ITEMS.length, 4, "the split assumes two tabs either side of the button");
});

console.log(`\n${passed} navigation assertions passed`);
if (failed > 0) throw new Error(`${failed} navigation assertion(s) failed`);
