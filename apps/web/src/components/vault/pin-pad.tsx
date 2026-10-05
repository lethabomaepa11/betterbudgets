"use client";

import { useEffect, useState } from "react";

import { Button } from "@betterbudgets/ui/components/button";
import { cn } from "@betterbudgets/ui/lib/utils";
import { Delete, Keyboard, KeyboardOff } from "lucide-react";

import { PIN_LENGTH } from "@/lib/local-db/credentials";

type PinPadProps = {
  value: string;
  onChange: (value: string) => void;
  /** Receives the completed value so the caller never races its own state. */
  onSubmit?: (value: string) => void;
  disabled?: boolean;
  className?: string;
};

const DIGITS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;

/**
 * 5-digit PIN entry.
 *
 * The keypad is the default because it is what makes a PIN usable on a phone;
 * "Use keyboard" switches to a real `<input>` for anyone who would rather type
 * (and for assistive tech that expects a form field). Physical keys are handled
 * in keypad mode so a desktop user is never stuck.
 */
export default function PinPad({
  value,
  onChange,
  onSubmit,
  disabled = false,
  className,
}: PinPadProps) {
  const [mode, setMode] = useState<"pad" | "text">("pad");

  function commit(next: string) {
    const clamped = next.replace(/\D/g, "").slice(0, PIN_LENGTH);
    onChange(clamped);

    if (clamped.length === PIN_LENGTH && onSubmit) {
      // Yield a frame so the fifth dot paints before the caller moves on,
      // rather than the screen changing while it still looks incomplete.
      setTimeout(() => onSubmit(clamped), 80);
    }
  }

  // Keypad mode has no focused field, so the page itself listens for keys.
  useEffect(() => {
    if (mode !== "pad" || disabled) return;

    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA") return;

      if (/^\d$/.test(event.key)) {
        event.preventDefault();
        commit(value + event.key);
      } else if (event.key === "Backspace") {
        event.preventDefault();
        commit(value.slice(0, -1));
      } else if (event.key === "Enter" && value.length === PIN_LENGTH && onSubmit) {
        event.preventDefault();
        onSubmit(value);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // `commit` closes over props that are reflected in `value` already.
  }, [mode, value, disabled, onSubmit]);

  return (
    <div className={cn("flex w-full flex-col items-center gap-5", className)}>
      <div
        role="group"
        aria-label={`PIN, ${value.length} of ${PIN_LENGTH} digits entered`}
        className="flex items-center gap-3"
      >
        {Array.from({ length: PIN_LENGTH }, (_, index) => (
          <span
            key={index}
            className={cn(
              "size-3 rounded-full transition-all duration-150",
              index < value.length
                ? "scale-110 bg-primary"
                : "bg-border ring-1 ring-foreground/10",
            )}
          />
        ))}
      </div>

      {mode === "pad" ? (
        <div className="grid w-full max-w-[19rem] grid-cols-3 gap-3">
          {DIGITS.map((digit) => (
            <Button
              key={digit}
              type="button"
              variant="outline"
              size="lg"
              disabled={disabled}
              onClick={() => commit(value + digit)}
              className="h-14 rounded-2xl text-xl font-medium tabular-nums"
            >
              {digit}
            </Button>
          ))}

          <Button
            type="button"
            variant="ghost"
            size="lg"
            disabled={disabled}
            onClick={() => setMode("text")}
            className="h-14 rounded-2xl"
            aria-label="Type the PIN with the keyboard instead"
          >
            <Keyboard aria-hidden="true" />
          </Button>

          <Button
            type="button"
            variant="outline"
            size="lg"
            disabled={disabled}
            onClick={() => commit(value + "0")}
            className="h-14 rounded-2xl text-xl font-medium tabular-nums"
          >
            0
          </Button>

          <Button
            type="button"
            variant="outline"
            size="lg"
            disabled={disabled}
            onClick={() => commit(value.slice(0, -1))}
            className="h-14 rounded-2xl"
            aria-label="Delete the last digit"
          >
            <Delete aria-hidden="true" />
          </Button>
        </div>
      ) : (
        <div className="flex w-full max-w-[19rem] flex-col gap-3">
          {/* A real field so screen readers and password managers engage with
              it; `numeric` asks phones for the digit pad. */}
          <input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            spellCheck={false}
            autoFocus
            maxLength={PIN_LENGTH}
            value={value}
            disabled={disabled}
            onChange={(event) => commit(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && value.length === PIN_LENGTH) {
                event.preventDefault();
                onSubmit?.(value);
              }
            }}
            aria-label={`PIN, ${PIN_LENGTH} digits`}
            placeholder={"•".repeat(PIN_LENGTH)}
            className={cn(
              "h-14 w-full rounded-2xl border border-input bg-transparent px-4 text-center",
              "text-3xl tracking-[0.5em] tabular-nums outline-none",
              "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40",
            )}
          />

          <Button
            type="button"
            variant="ghost"
            disabled={disabled}
            onClick={() => setMode("pad")}
            className="gap-2"
          >
            <KeyboardOff aria-hidden="true" />
            Use keypad
          </Button>
        </div>
      )}
    </div>
  );
}
