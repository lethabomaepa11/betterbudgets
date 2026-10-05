import { cn, useThemeColor } from "heroui-native";
import { Image, Text, View } from "react-native";

/** Aspect ratio (width / height) of the `logo.png` lockup artwork. */
const LOCKUP_RATIO = 1024 / 671;

type LogoProps = {
  /** Square size of the monogram in px. */
  size?: number;
  /** Render the "betterbudgets" wordmark next to the monogram. */
  showWordmark?: boolean;
  className?: string;
};

/**
 * The betterbudgets monogram ("BB" + emerald leaf). Transparent, so it sits on
 * any surface in light or dark mode.
 */
export function Logo({ size = 28, showWordmark = false, className }: LogoProps) {
  const foreground = useThemeColor("foreground");

  return (
    <View className={cn("flex-row items-center gap-2", className)}>
      <Image
        source={require("@/assets/images/logo-mark.png")}
        style={{ width: size, height: size }}
        resizeMode="contain"
        accessibilityLabel="betterbudgets"
      />
      {showWordmark ? (
        <Text
          style={{
            color: foreground,
            fontSize: Math.round(size * 0.68),
            fontWeight: "600",
          }}
        >
          betterbudgets
        </Text>
      ) : null}
    </View>
  );
}

type LogoLockupProps = {
  /** Rendered width in px; height follows the artwork's 1024x671 ratio. */
  width?: number;
  className?: string;
};

/** Full lockup (monogram + wordmark) for auth and empty states. */
export function LogoLockup({ width = 200, className }: LogoLockupProps) {
  return (
    <View className={cn("items-center", className)}>
      <Image
        source={require("@/assets/images/logo.png")}
        style={{ width, height: Math.round(width / LOCKUP_RATIO) }}
        resizeMode="contain"
        accessibilityLabel="betterbudgets"
      />
    </View>
  );
}
