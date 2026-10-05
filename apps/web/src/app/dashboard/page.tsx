import type { Metadata } from "next";

import VaultGate from "@/components/vault/gate";

import Dashboard from "./dashboard";

export const metadata: Metadata = {
  title: "Home",
};

/** The app shell. `VaultGate` decides first-run, locked, or the real screen. */
export default function DashboardPage() {
  return (
    <VaultGate>
      <Dashboard />
    </VaultGate>
  );
}
