// Credential storage and verification for the local profile.
//
// Threat model: this protects someone else with physical access to the browser
// profile (or a copy of `sqlite3.wasm`'s database file) from reading a budget.
// It is *not* a defence against an attacker who already runs code in this
// browser — nothing client-side can be.
//
// What that means in practice:
//
// * The PIN/password is never stored. A random 16-byte salt plus a PBKDF2-SHA256
//   verifier are stored instead, so the file alone does not contain the secret.
// * A 5-digit PIN only carries ~16.6 bits of entropy, so an attacker who has the
//   database *can* brute-force it given enough time. The high iteration count
//   and the lockout below raise that cost; they do not eliminate it. That
//   residual risk is inherent to a 5-digit PIN, not a mistake in this code — use
//   a password if that trade-off matters.
// * Nothing here survives the tab. The *session* lives in React state
//   (`vault.tsx`); this module only ever derives and compares values.

import type { CredentialType } from "./schema";

/** Exactly five digits, as specified. */
export const PIN_LENGTH = 5;
export const PIN_PATTERN = new RegExp(`^\\d{${PIN_LENGTH}}$`);

/** Minimum length for the free-text option. Not specified by the model. */
export const MIN_PASSWORD_LENGTH = 8;

/**
 * OWASP's recommended iteration count for PBKDF2-SHA256 (2023 guidance). Kept
 * in lockstep with `Profile.iterations`, which is persisted per row so that
 * raising this later still lets existing profiles unlock.
 */
export const PBKDF2_ITERATIONS = 310_000;

/** Attempts required to trigger the first lockout. */
export const ATTEMPTS_TO_LOCKOUT = 5;

/** First lockout is 15s, then it doubles per extra failure, capped at 5 minutes. */
export const MAX_LOCKOUT_MS = 300_000;
const BASE_LOCKOUT_MS = 15_000;

export class LockoutError extends Error {
  readonly retryAfterMs: number;

  constructor(retryAfterMs: number) {
    super("Too many attempts. Try again in a moment.");
    this.name = "LockoutError";
    this.retryAfterMs = retryAfterMs;
  }
}

export class InsecureContextError extends Error {
  constructor() {
    super("This page must be served over HTTPS or from localhost to use a PIN.");
    this.name = "InsecureContextError";
  }
}

function secureCrypto(): Crypto {
  // `crypto.subtle` is undefined outside a secure context; there is no fallback
  // that would still be worth storing.
  if (!globalThis.crypto?.subtle) throw new InsecureContextError();
  return globalThis.crypto;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Explicit `ArrayBufferLike` type argument keeps it assignable to `BufferSource`. */
function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/** Cryptographically random bytes, base64-encoded. */
export function generateSalt(): string {
  const bytes = new Uint8Array(16);
  secureCrypto().getRandomValues(bytes);
  return toBase64(bytes);
}

/** Random, non-secret id for a new profile. */
export function newProfileId(): string {
  return crypto.randomUUID();
}

/**
 * Derives the stored verifier. The secret itself is only ever an input here —
 * nothing in the app retains it after this resolves.
 */
export async function deriveVerifier(
  secret: string,
  saltBase64: string,
  iterations: number = PBKDF2_ITERATIONS,
): Promise<string> {
  const subtle = secureCrypto().subtle;

  const keyMaterial = await subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    "PBKDF2",
    false,
    ["deriveBits"],
  );

  const bits = await subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: fromBase64(saltBase64), iterations },
    keyMaterial,
    256,
  );

  return toBase64(new Uint8Array(bits));
}

/**
 * Compares two base64 strings without early return, so the comparison does not
 * leak the verifier byte-by-byte through timing.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index++) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return difference === 0;
}

/** Milliseconds the profile stays locked after this many failures, or 0. */
export function lockoutMsFor(attempts: number): number {
  if (attempts < ATTEMPTS_TO_LOCKOUT) return 0;
  const excess = attempts - ATTEMPTS_TO_LOCKOUT;
  return Math.min(BASE_LOCKOUT_MS * 2 ** excess, MAX_LOCKOUT_MS);
}

/** Remaining lockout in ms, or 0 when the profile may be tried. */
export function remainingLockoutMs(lockedUntil: string | null, now = Date.now()): number {
  if (!lockedUntil) return 0;
  return Math.max(0, Date.parse(lockedUntil) - now);
}

export function profileIsLocked(
  lockedUntil: string | null,
  now = Date.now(),
): boolean {
  return remainingLockoutMs(lockedUntil, now) > 0;
}
