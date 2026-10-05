/**
 * The navigation model, with no icon imports.
 *
 * Separated from `nav-items.ts` on purpose: the icons are a rendering concern, and
 * keeping them out means the rules below (five slots, nothing unreachable, no
 * duplicated destinations) can be asserted directly by the unit tests. Every rule
 * here has previously been broken by a plausible-looking change â€” one more tab,
 * one more screen â€” and each of those is now a failing test rather than
 * something to notice by eye.
 *
 * Icon names are strings rather than components precisely so this stays data.
 */
export type NavIcon = "home" | "wallet" | "target" | "more" | "landmark" | "repeat" | "trophy" | "chart" | "settings";

export type NavEntry = {
  href: string;
  label: string;
  Icon: NavIcon;
  /** Only on rows inside MORE_SCREENS, where there is room to explain. */
  description?: string;
};

/**
 * The tab bar, exactly four entries.
 *
 * Typed as a mutable array of `NavEntry` rather than a `const` tuple on purpose.
 * A literal tuple gives every href its own type, which then makes the navigation
 * tests fail to compile the moment they compare a tab against a route that is
 * not a tab â€” which is most of what they need to do. Widening to `string` keeps
 * the tests honest about what they are checking.
 */
export const NAV_ITEMS: readonly NavEntry[] = [
  { href: "/dashboard", label: "Home", Icon: "home" },
  { href: "/activity", label: "Activity", Icon: "wallet" },
  { href: "/budgets", label: "Budgets", Icon: "target" },
  { href: "/more", label: "More", Icon: "more" },
];


/**
 * Everything reachable from "More", grouped so the list reads as an inventory of
 * the app rather than a pile of links. Each row says what the screen is for,
 * because "Reports" and "Activity" are only distinguishable once you are inside
 * them.
 */
export const MORE_SCREENS: readonly {
  title: string;
  items: readonly NavEntry[];
}[] = [
  {
    title: "Money",
    items: [
      { href: "/accounts", label: "Accounts", description: "Balances and what each one is for", Icon: "landmark" },
      { href: "/recurring", label: "Repeating money", description: "Rent, salary, subscriptions", Icon: "repeat" },
      { href: "/goals", label: "Goals", description: "What you are saving for", Icon: "trophy" },
    ],
  },
  {
    title: "Look back",
    items: [
      { href: "/reports", label: "Reports", description: "Where the money went", Icon: "chart" },
    ],
  },
  {
    title: "This device",
    items: [
      { href: "/settings", label: "Settings", description: "Currency, profile, your data", Icon: "settings" },
    ],
  },
];

/** Every screen the app has. Used by the test that checks nothing is unreachable. */
export const ALL_APP_ROUTES = [
  "/dashboard",
  "/activity",
  "/budgets",
  "/more",
  "/accounts",
  "/recurring",
  "/goals",
  "/reports",
  "/settings",
] as const;

/** The most slots the bottom bar may use, including the action button. */
export const MAX_NAV_SLOTS = 5;

/**
 * The primary action, sitting between the two middle tabs.
 *
 * Logging a transaction is by far the most frequent thing a user does here, so
 * it gets the centre and a full tap target rather than being buried in a menu.
 */
export const NAV_CENTER = {
  href: "/transactions/new",
  label: "Add a transaction",
} as const;

/** True when `pathname` is inside the route `href` points at. */
export function isActivePath(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
