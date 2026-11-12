import { hash, verify, type Algorithm } from '@node-rs/argon2';

/** OWASP's current minimum recommendation is 8; we ask for more. */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

/**
 * Argon2id is value 2 in the libargon2 enum. The package declares `Algorithm`
 * as an ambient const enum, which cannot be referenced under `isolatedModules`,
 * so the numeric value is used with a cast to keep the option type-checked.
 */
const ARGON2ID = 2 as Algorithm;

/**
 * Argon2id parameters from OWASP's password storage cheat sheet (19 MiB,
 * t=2, p=1). They are deliberately not configurable per environment: a weaker
 * hash in development that ships to production is a classic incident.
 */
const ARGON2_OPTIONS = {
  algorithm: ARGON2ID,
  memoryCost: 19_456, // KiB
  timeCost: 2,
  parallelism: 1,
} as const;

export async function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

/**
 * Returns false for malformed hashes instead of throwing. A corrupt row must not
 * turn a failed login into a 500 that reveals the account exists.
 */
export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}
