import { Bell, ChartPie, Home, Settings, Target, Trophy } from "lucide-react";

/**
 * Single source of truth for top-level navigation. Both the desktop header and
 * the mobile bottom bar read from here, so the two can never drift apart.
 *
 * `href` values are kept as literals so Next's `typedRoutes` can verify them.
 *
 * Order matters: the first entry sits left of the bottom bar's primary action and
 * the rest sit to its right, so the centre slot is always the button rather than
 * whichever item happens to be second. A new screen appended to the end therefore
 * lands on the right without silently displacing the button.
 */
export const NAV_ITEMS = [
  { href: "/dashboard", label: "Home", Icon: Home },
  { href: "/activity", label: "Activity", Icon: Bell },
  { href: "/reports", label: "Reports", Icon: ChartPie },
  { href: "/budgets", label: "Budgets", Icon: Target },
  { href: "/goals", label: "Goals", Icon: Trophy },
  { href: "/settings", label: "Settings", Icon: Settings },
] as const;

/**
 * The primary action, rendered between the two nav items on the bottom bar.
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