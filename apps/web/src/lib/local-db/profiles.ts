// Reads and writes for the local profile (the diagram's `User`).
//
// Credential material lives here and only here: `profiles` is deliberately
// absent from `SYNCABLE_TABLES`, so a future sync engine has no code path that
// could ship a salt or verifier anywhere.
import type { LocalDb } from "./client";
import {
  constantTimeEqual,
  deriveVerifier,
  generateSalt,
  lockoutMsFor,
  LockoutError,
  MIN_PASSWORD_LENGTH,
  newProfileId,
  PBKDF2_ITERATIONS,
  PIN_LENGTH,
  PIN_PATTERN,
  remainingLockoutMs,
} from "./credentials";
import type {
  BudgetFor,
  CredentialType,
  OnboardingStep,
  ProfileSummary,
} from "./schema";

/**
 * Fallback display currency, mirroring the column default added in schema v3.
 * A brand-new profile always writes this explicitly, so it is only reached if a
 * row somehow predates the migration.
 */
export const DEFAULT_CURRENCY = "USD";

/**
 * Currencies offered in settings. Checked with `Intl` rather than a hardcoded
 * allowlist so the browser's own ICU data decides what is supported — that
 * avoids a list that silently disagrees with the formatter used everywhere else.
 */
export function isSupportedCurrency(code: string): boolean {
  try {
    new Intl.NumberFormat(undefined, { style: "currency", currency: code });
    return true;
  } catch {
    return false;
  }
}

/** The currency codes this device can actually format, for the settings picker. */
export function supportedCurrencies(): string[] {
  return ["USD", "EUR", "GBP", "ZAR", "AUD", "CAD", "JPY", "INR", "NGN", "KES"].filter(
    isSupportedCurrency,
  );
}

type CredentialRow = {
  id: string;
  name: string;
  credential_type: CredentialType;
  salt: string;
  verifier: string;
  iterations: number;
  failed_attempts: number;
  locked_until: string | null;
};

/** Thrown when the secret is wrong but the profile is not yet locked out. */
export class IncorrectCredentialError extends Error {
  constructor(credentialType: CredentialType) {
    super(credentialType === "pin" ? "That PIN is not correct." : "That password is not correct.");
    this.name = "IncorrectCredentialError";
  }
}

/** Client-side validation shared by onboarding and the lock screen. */
export function validateSecret(
  credentialType: CredentialType,
  secret: string,
): string | null {
  if (credentialType === "pin") {
    return PIN_PATTERN.test(secret)
      ? null
      : `Your PIN must be exactly ${PIN_LENGTH} digits.`;
  }
  return secret.length >= MIN_PASSWORD_LENGTH
    ? null
    : `Your password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
}

/**
 * Profile rows without credential material. `ProfileSummary` is what every UI
 * surface receives, so a verifier can never leak into props by accident.
 */
export async function listProfiles(db: LocalDb): Promise<ProfileSummary[]> {
  return db.query<ProfileSummary>(
    `SELECT id, name, credential_type, failed_attempts, locked_until, currency,
            onboarding_step, budget_for
       FROM profiles
      ORDER BY created_at ASC`,
  );
}

export async function createProfile(
  db: LocalDb,
  input: { name: string; credentialType: CredentialType; secret: string },
): Promise<ProfileSummary> {
  const name = input.name.trim();
  if (!name) throw new Error("Please give your local profile a name.");

  const validation = validateSecret(input.credentialType, input.secret);
  if (validation) throw new Error(validation);

  const salt = generateSalt();
  const verifier = await deriveVerifier(input.secret, salt);
  const timestamp = new Date().toISOString();
  const id = newProfileId();

  await db.batch([
    {
      sql: `INSERT INTO profiles
              (id, name, credential_type, salt, verifier, kdf, iterations,
               failed_attempts, locked_until, created_at, updated_at, origin, currency)
            VALUES (?, ?, ?, ?, ?, 'PBKDF2-SHA256', ?, 0, NULL, ?, ?, 'local', ?)`,
      bind: [
        id,
        name,
        input.credentialType,
        salt,
        verifier,
        PBKDF2_ITERATIONS,
        timestamp,
        timestamp,
        DEFAULT_CURRENCY,
      ],
    },
  ]);

  // The secret is verified against the row we just wrote so creation and the
  // first unlock take exactly the same path — no special case to drift later.
  await unlockProfile(db, id, input.secret);

  return {
    id,
    name,
    credential_type: input.credentialType,
    failed_attempts: 0,
    locked_until: null,
    currency: DEFAULT_CURRENCY,
    // A brand-new profile starts at the first step; the guided setup advances it
  // as each screen is completed. `VaultGate` redirects here until it reaches
  // "done", so this is the single entry point into onboarding.
  onboarding_step: "currency",
  budget_for: null,
  };
}

/**
 * Verifies a secret and resets the failure counter on success.
 *
 * Failures are recorded *before* throwing so that a locked-out profile reports
 * its lockout on the very next attempt rather than only after one more miss.
 */
export async function unlockProfile(
  db: LocalDb,
  profileId: string,
  secret: string,
): Promise<void> {
  const [credential] = await db.query<CredentialRow>(
    `SELECT id, name, credential_type, salt, verifier, iterations, failed_attempts, locked_until
       FROM profiles WHERE id = ?`,
    [profileId],
  );

  if (!credential) throw new Error("That local profile no longer exists.");

  const remaining = remainingLockoutMs(credential.locked_until);
  if (remaining > 0) throw new LockoutError(remaining);

  const candidate = await deriveVerifier(secret, credential.salt, credential.iterations);
  const matches = constantTimeEqual(candidate, credential.verifier);

  if (matches) {
    if (credential.failed_attempts > 0 || credential.locked_until) {
      await db.batch([
        {
          sql: "UPDATE profiles SET failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE id = ?",
          bind: [new Date().toISOString(), profileId],
        },
      ]);
    }
    return;
  }

  const attempts = credential.failed_attempts + 1;
  const lockoutMs = lockoutMsFor(attempts);
  const lockedUntil = lockoutMs > 0 ? new Date(Date.now() + lockoutMs).toISOString() : null;

  await db.batch([
    {
      sql: "UPDATE profiles SET failed_attempts = ?, locked_until = ?, updated_at = ? WHERE id = ?",
      bind: [attempts, lockedUntil, new Date().toISOString(), profileId],
    },
  ]);

  throw lockoutMs > 0 ? new LockoutError(lockoutMs) : new IncorrectCredentialError(credential.credential_type);
}

/**
 * Moves the guided setup to `step`.
 *
 * Separate from `updateProfileSettings` on purpose: onboarding writes this column
 * and settings never does, so there is no way for a rename to restart setup.
 */
export async function setOnboarding(
  db: LocalDb,
  profileId: string,
  step: OnboardingStep,
  budgetFor: BudgetFor | null,
): Promise<void> {
  await db.batch([
    {
      sql: "UPDATE profiles SET onboarding_step = ?, budget_for = ?, updated_at = ? WHERE id = ?",
      bind: [step, budgetFor, new Date().toISOString(), profileId],
    },
  ]);
}

/**
 * Display preferences only. Deliberately a separate function from every
 * credential path so there is no way to write `salt`/`verifier` from here — the
 * credential is changed by unlocking with the old secret, never by settings.
 */
export async function updateProfileSettings(
  db: LocalDb,
  profileId: string,
  settings: { name: string; currency: string },
): Promise<ProfileSummary> {
  const name = settings.name.trim();
  if (!name) throw new Error("Your profile needs a name.");

  const currency = settings.currency.trim().toUpperCase();
  if (!isSupportedCurrency(currency)) {
    throw new Error("That currency code isn't recognised.");
  }

  // The display settings must not clobber onboarding progress — renaming
  // yourself in settings should never restart the guided setup.
  const [current] = await db.query<{
    credential_type: CredentialType;
    onboarding_step: OnboardingStep;
    budget_for: BudgetFor | null;
  }>(
    "SELECT credential_type, onboarding_step, budget_for FROM profiles WHERE id = ?",
    [profileId],
  );
  if (!current) throw new Error("That local profile no longer exists.");

  const timestamp = new Date().toISOString();
  await db.batch([
    {
      sql: "UPDATE profiles SET name = ?, currency = ?, updated_at = ? WHERE id = ?",
      bind: [name, currency, timestamp, profileId],
    },
  ]);

  return {
    id: profileId,
    name,
    credential_type: current.credential_type,
    failed_attempts: 0,
    locked_until: null,
    currency,
    onboarding_step: current.onboarding_step,
    budget_for: current.budget_for,
  };
}
