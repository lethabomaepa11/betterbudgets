import { Button } from "@betterbudgets/ui/components/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@betterbudgets/ui/components/card";
import { ArrowRight, CloudOff, Download, RefreshCw, ShieldCheck, Wallet } from "lucide-react";
import Link from "next/link";

import { LogoLockup } from "@/components/logo";

const FEATURES = [
  {
    Icon: CloudOff,
    title: "Works offline",
    body: "Your ledger lives in your own device's database, not on a server. Flights, subways, dead zones — nothing stops you logging a coffee.",
  },
  {
    Icon: ShieldCheck,
    title: "Yours by default",
    body: "No account needed to start. Create one only if you decide you want your numbers on a second device.",
  },
  {
    Icon: RefreshCw,
    title: "Sync on your terms",
    body: "Turn sync on and your devices converge. Leave it off and your data stays exactly where it is.",
  },
  {
    Icon: Wallet,
    title: "Built for budgets",
    body: "Envelopes, categories and recurring bills, with income and spending you can read at a glance.",
  },
] as const;

export default function Home() {
  return (
    <div className="flex flex-col gap-14 py-6 sm:py-10">
      <section className="relative isolate flex flex-col items-center gap-6 text-center">
        {/* Decorative brand wash behind the hero. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-32 left-1/2 -z-10 size-[34rem] -translate-x-1/2 rounded-full bg-primary-subtle blur-3xl"
        />

        <LogoLockup width={260} priority className="h-auto w-[200px] sm:w-[260px]" />

        <h1 className="max-w-2xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
          Budgeting that keeps working when the network doesn&apos;t
        </h1>

        <p className="max-w-xl text-pretty text-muted-foreground sm:text-lg">
          betterbudgets runs on your device first. Start tracking in seconds — no sign-up. Add an
          account later, when you want your numbers everywhere.
        </p>

        <div className="flex w-full flex-col gap-3 sm:w-auto">
          <Button size="lg" render={<Link href="/dashboard" />}>
            Open my budget
            <ArrowRight data-icon="inline-end" />
          </Button>

          {/* Deliberately not a button: signing up is optional, so it should not
              read as the second half of a required step. */}
          <p className="text-sm text-muted-foreground">
            No sign-up to start. Add an account later if you want sync across devices.
          </p>
          <Button variant="outline" render={<Link href="/download" />}>
            <Download data-icon="inline-start" /> Get the mobile app
          </Button>
        </div>
      </section>

      <section aria-label="Why betterbudgets" className="grid gap-4 sm:grid-cols-2">
        {FEATURES.map(({ Icon, title, body }) => (
          <Card key={title}>
            <CardHeader>
              <span className="mb-1 flex size-11 items-center justify-center rounded-2xl bg-primary-subtle text-primary">
                <Icon className="size-5" aria-hidden="true" />
              </span>
              <CardTitle>{title}</CardTitle>
              <CardDescription>{body}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </section>
    </div>
  );
}
