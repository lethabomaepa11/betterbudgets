import Image from "next/image";

import { cn } from "@betterbudgets/ui/lib/utils";

/** Aspect ratio (width / height) of the `logo.png` lockup artwork. */
const LOCKUP_RATIO = 1024 / 671;

type LogoProps = {
  /** Square size of the monogram in px. */
  size?: number;
  className?: string;
  priority?: boolean;
};

/**
 * The betterbudgets monogram ("BB" + emerald leaf). Transparent, so it sits on
 * any surface in light or dark mode.
 */
export function Logo({ size = 28, className, priority = false }: LogoProps) {
  return (
    <Image
      src="/logo-mark.png"
      alt="betterbudgets"
      width={size}
      height={size}
      priority={priority}
      className={cn("shrink-0 select-none", className)}
    />
  );
}

type LogoLockupProps = {
  /** Rendered width in px; height follows the artwork's 1024x671 ratio. */
  width?: number;
  className?: string;
  priority?: boolean;
};

/** Full lockup (monogram + wordmark) for auth and marketing screens. */
export function LogoLockup({ width = 220, className, priority = false }: LogoLockupProps) {
  return (
    <Image
      src="/logo.png"
      alt="betterbudgets"
      width={width}
      height={Math.round(width / LOCKUP_RATIO)}
      priority={priority}
      className={cn("select-none", className)}
    />
  );
}
