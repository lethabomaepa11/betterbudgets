"use client";

import { Button } from "@betterbudgets/ui/components/button";
import { Lock } from "lucide-react";

import { useVault } from "@/lib/local-db/vault";

/**
 * "Lock now", available whenever the vault is unlocked.
 *
 * Signing out drops the in-memory session only — the local profile and every
 * row in the database stay exactly where they are, because this is an unlock,
 * not an account deletion.
 */
export default function LockButton() {
  const { status, logout } = useVault();

  if (status !== "unlocked") return null;

  return (
    <Button variant="outline" size="icon" onClick={logout} aria-label="Lock and sign out">
      <Lock aria-hidden="true" />
    </Button>
  );
}
