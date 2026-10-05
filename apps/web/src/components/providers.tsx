"use client";

import { Toaster } from "@betterbudgets/ui/components/sonner";

import { LocalDbProvider, useLocalDb } from "@/lib/local-db/provider";
import { SyncProvider } from "@/lib/local-db/sync-provider";
import { VaultProvider } from "@/lib/local-db/vault";

import { Logo } from "./logo";
import PageTransitionGate from "./page-transition-gate";
import { ThemeProvider } from "./theme-provider";

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <LocalDbProvider>
        {/* Vault sits inside the database provider — unlocking reads the
            profile row — and outside the app so the header can offer "lock". */}
        <VaultProvider>
          <SyncProvider>
            {children}
            <PageTransitionGate />
            <StartupLoader />
            <Toaster richColors />
          </SyncProvider>
        </VaultProvider>
      </LocalDbProvider>
    </ThemeProvider>
  );
}

function StartupLoader() {
  const { status } = useLocalDb();

  if (status !== "opening") return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-4 bg-background/95 text-muted-foreground backdrop-blur-sm"
      role="status"
      aria-live="polite"
      aria-label="Opening your budget"
    >
      <Logo
        size={72}
        priority
        className="motion-safe:animate-[logo-loader_1.4s_ease-in-out_infinite]"
      />
      <p className="text-sm">Opening your budget…</p>
    </div>
  );
}
