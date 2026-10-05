import {
  ChartPie,
  Ellipsis,
  Home,
  Landmark,
  Repeat,
  Settings,
  Target,
  Trophy,
  Wallet,
} from "lucide-react";

import {
  MORE_SCREENS as MODEL_MORE_SCREENS,
  NAV_ITEMS as MODEL_NAV_ITEMS,
  type NavIcon,
} from "@/lib/nav-model";

/**
 * Binds the navigation model's icon names to components.
 *
 * The model lives in `@/lib/nav-model` with no icon imports, which is what lets
 * the navigation rules (five slots, nothing unreachable, no duplicates) be unit
 * tested. This file is the only place that knows an icon is a component, so there
 * is exactly one mapping to keep in step.
 */
const ICONS: Record<NavIcon, typeof Home> = {
  home: Home,
  wallet: Wallet,
  target: Target,
  more: Ellipsis,
  landmark: Landmark,
  repeat: Repeat,
  trophy: Trophy,
  chart: ChartPie,
  settings: Settings,
};

/** The tab bar, with icons resolved. */
export const NAV_ITEMS = MODEL_NAV_ITEMS.map((entry) => ({
  ...entry,
  Icon: ICONS[entry.Icon],
}));

/** `MORE_SCREENS` from the model, with icons resolved. */
export const MORE_SCREENS = MODEL_MORE_SCREENS.map((group) => ({
  ...group,
  items: group.items.map((item) => ({ ...item, Icon: ICONS[item.Icon] })),
}));

export { ALL_APP_ROUTES, isActivePath, MAX_NAV_SLOTS, NAV_CENTER } from "@/lib/nav-model";