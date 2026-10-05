"use client";

import { Toaster } from "@betterbudgets/ui/components/sonner";

import { LocalDbProvider } from "@/lib/local-db/provider";
import { VaultProvider } from "@/lib/local-db/vault";

import { ThemeProvider } from "./theme-provider";

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <LocalDbProvider>
        {/* Vault sits inside the database provider — unlocking reads the
            profile row — and outside the app so the header can offer "lock". */}
        <VaultProvider>
          {children}
          <Toaster richColors />
        </VaultProvider>
      </LocalDbProvider>
    </ThemeProvider>
  );
}
