"use client";

import { useState } from "react";

import { Button } from "@betterbudgets/ui/components/button";
import { cn } from "@betterbudgets/ui/lib/utils";
import { ArrowLeft, ArrowRight, Hash, KeyRound, UserRound } from "lucide-react";

import { MIN_PASSWORD_LENGTH, PIN_LENGTH } from "@/lib/local-db/credentials";
import type { CredentialType } from "@/lib/local-db/schema";
import { useVault } from "@/lib/local-db/vault";

import CredentialEntry from "./credential-entry";

type Step = "name" | "method" | "secret";

const METHODS: readonly {
  credentialType: CredentialType;
  Icon: typeof KeyRound;
  title: string;
  description: string;
}[] = [
  {
    credentialType: "password",
    Icon: KeyRound,
    title: "Password",
    description: `Anything you like, at least ${MIN_PASSWORD_LENGTH} characters.`,
  },
  {
    credentialType: "pin",
    Icon: Hash,
    title: "PIN",
    description: `${PIN_LENGTH} digits. Tap the keypad or type it.`,
  },
];

const FIELD_CLASS = cn(
  "h-14 w-full rounded-2xl border border-input bg-transparent px-4 text-base outline-none",
  "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40",
);

/**
 * First run: no local profile exists yet.
 *
 * Three short steps rather than one dense form — a phone-sized flow that ends
 * with a credential typed once and confirmed once.
 */
export default function VaultOnboarding() {
  const { createProfile, busy, error, clearError } = useVault();

  const [step, setStep] = useState<Step>("name");
  const [name, setName] = useState("");
  const [credentialType, setCredentialType] = useState<CredentialType>("pin");
  const [secret, setSecret] = useState("");
  const [confirmation, setConfirmation] = useState("");

  function choose(type: CredentialType) {
    clearError();
    setCredentialType(type);
    setSecret("");
    setConfirmation("");
    setStep("secret");
  }

  function submit() {
    clearError();
    void createProfile({ name, credentialType, secret });
  }

  const secretIsComplete =
    credentialType === "pin"
      ? secret.length === PIN_LENGTH
      : secret.length >= MIN_PASSWORD_LENGTH && secret === confirmation;

  return (
    <div className="mx-auto w-full max-w-md">
      <div className="rounded-3xl bg-card p-6 shadow-card ring-1 ring-foreground/6 sm:p-8">
        {step === "name" && (
          <>
            <h1 className="text-2xl font-semibold tracking-tight">Create your local profile</h1>
            <p className="mt-2 text-sm/relaxed text-muted-foreground">
              This lives on this device only. You can add sync to your other devices later —
              nothing here asks for an email.
            </p>

            <label htmlFor="profile-name" className="mt-6 block text-sm font-medium">
              What should we call you?
            </label>
            <input
              id="profile-name"
              value={name}
              autoFocus
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && name.trim()) {
                  clearError();
                  setStep("method");
                }
              }}
              placeholder="Your name"
              autoComplete="name"
              className={cn(FIELD_CLASS, "mt-2")}
            />

            <Button
              size="lg"
              disabled={!name.trim()}
              onClick={() => {
                clearError();
                setStep("method");
              }}
              className="mt-6 h-14 w-full rounded-2xl text-base"
            >
              Continue
              <ArrowRight data-icon="inline-end" />
            </Button>
          </>
        )}

        {step === "method" && (
          <>
            <button
              type="button"
              onClick={() => setStep("name")}
              className="mb-4 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <ArrowLeft className="size-4" aria-hidden="true" />
              Back
            </button>

            <h1 className="text-2xl font-semibold tracking-tight">How do you want to unlock?</h1>
            <p className="mt-2 text-sm/relaxed text-muted-foreground">
              Either way, it is only ever checked on this device.
            </p>

            <div className="mt-6 grid gap-3">
              {METHODS.map(({ credentialType: type, Icon, title, description }) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => choose(type)}
                  className={cn(
                    "flex w-full items-start gap-4 rounded-2xl border border-border bg-background p-4 text-left",
                    "transition-all hover:border-primary/40 hover:bg-primary-subtle",
                    "focus-visible:ring-2 focus-visible:ring-ring/40 outline-none",
                  )}
                >
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-primary-subtle text-primary">
                    <Icon className="size-5" aria-hidden="true" />
                  </span>
                  <span className="min-w-0">
                    <span className="block font-medium">{title}</span>
                    <span className="block text-sm text-muted-foreground">{description}</span>
                  </span>
                </button>
              ))}
            </div>
          </>
        )}

        {step === "secret" && (
          <>
            <button
              type="button"
              onClick={() => setStep("method")}
              className="mb-4 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <ArrowLeft className="size-4" aria-hidden="true" />
              Back
            </button>

            <div className="flex items-center gap-3">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-primary-subtle text-primary">
                {credentialType === "pin" ? (
                  <Hash className="size-5" aria-hidden="true" />
                ) : (
                  <KeyRound className="size-5" aria-hidden="true" />
                )}
              </span>
              <div>
                <h1 className="text-2xl font-semibold tracking-tight">
                  {credentialType === "pin" ? "Create your PIN" : "Create your password"}
                </h1>
                <p className="text-sm text-muted-foreground">
                  {credentialType === "pin"
                    ? `Exactly ${PIN_LENGTH} digits`
                    : `At least ${MIN_PASSWORD_LENGTH} characters`}
                </p>
              </div>
            </div>

            <div className="mt-6">
              <CredentialEntry
                credentialType={credentialType}
                value={secret}
                onChange={setSecret}
                disabled={busy}
              />
            </div>

            {credentialType === "password" && (
              <div className="mt-4">
                <label htmlFor="confirm-secret" className="block text-sm font-medium">
                  Confirm it
                </label>
                <input
                  id="confirm-secret"
                  type="password"
                  autoComplete="new-password"
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  placeholder="Type it again"
                  className={FIELD_CLASS}
                />

                {secret.length >= MIN_PASSWORD_LENGTH && confirmation && secret !== confirmation && (
                  <p className="mt-2 text-xs text-expense-strong">Those two don&apos;t match yet.</p>
                )}
              </div>
            )}

            {error && (
              <p role="alert" className="mt-4 text-sm text-expense-strong">
                {error}
              </p>
            )}

            <Button
              size="lg"
              disabled={busy || !secretIsComplete}
              onClick={submit}
              className="mt-6 h-14 w-full rounded-2xl text-base"
            >
              <UserRound data-icon="inline-start" />
              {busy ? "Creating…" : "Create my profile"}
            </Button>
          </>
        )}
      </div>

      {error && step !== "secret" && (
        <p role="alert" className="mt-4 text-center text-sm text-expense-strong">
          {error}
        </p>
      )}
    </div>
  );
}
