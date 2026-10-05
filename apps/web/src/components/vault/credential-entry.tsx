"use client";

import { useState } from "react";

import { Button } from "@betterbudgets/ui/components/button";
import { cn } from "@betterbudgets/ui/lib/utils";
import { Eye, EyeOff } from "lucide-react";

import { MIN_PASSWORD_LENGTH } from "@/lib/local-db/credentials";
import type { CredentialType } from "@/lib/local-db/schema";

import PinPad from "./pin-pad";

type CredentialEntryProps = {
  credentialType: CredentialType;
  value: string;
  onChange: (value: string) => void;
  /** Receives the value so the caller never races its own state. */
  onSubmit?: (value: string) => void;
  disabled?: boolean;
  className?: string;
};

/**
 * One entry control for either credential type.
 *
 * Deliberately not a `<form>`: the PIN keypad auto-submits on the fifth digit,
 * and a `<form>` wrapper would need `action=""` + `preventDefault()` to keep
 * that from double-firing. A controlled value plus an explicit submit button
 * keeps the two paths identical.
 */
export default function CredentialEntry({
  credentialType,
  value,
  onChange,
  onSubmit,
  disabled = false,
  className,
}: CredentialEntryProps) {
  const [revealed, setRevealed] = useState(false);

  if (credentialType === "pin") {
    return (
      <PinPad
        value={value}
        onChange={onChange}
        onSubmit={onSubmit}
        disabled={disabled}
        className={className}
      />
    );
  }

  return (
    <div className={cn("flex w-full flex-col gap-3", className)}>
      <div className="relative">
        <input
          type={revealed ? "text" : "password"}
          autoComplete="current-password"
          spellCheck={false}
          autoFocus
          minLength={MIN_PASSWORD_LENGTH}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onSubmit?.(value);
            }
          }}
          aria-label="Password"
          placeholder="Your password"
          className={cn(
            "h-14 w-full rounded-2xl border border-input bg-transparent px-4 pr-12 text-base outline-none",
            "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40",
            "disabled:cursor-not-allowed disabled:opacity-50",
          )}
        />

        <button
          type="button"
          onClick={() => setRevealed((previous) => !previous)}
          disabled={disabled}
          aria-label={revealed ? "Hide password" : "Show password"}
          className={cn(
            "absolute right-3 top-1/2 -translate-y-1/2 rounded-xl p-2 text-muted-foreground",
            "transition-colors hover:bg-accent hover:text-foreground",
            "focus-visible:ring-2 focus-visible:ring-ring/40 outline-none",
          )}
        >
          {revealed ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
        </button>
      </div>

      {onSubmit && (
        <Button
          type="button"
          size="lg"
          disabled={disabled || value.length < MIN_PASSWORD_LENGTH}
          onClick={() => onSubmit(value)}
          className="h-14 rounded-2xl text-base"
        >
          Continue
        </Button>
      )}
    </div>
  );
}
