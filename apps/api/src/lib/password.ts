import argon2 from 'argon2';

import { sessionEnv } from '../config/env.js';

/**
 * Argon2id with parameters from the environment. The OWASP baseline is
 * m=19456 (19 MiB), t=2, p=1, which is the default here.
 *
 * argon2id is chosen over argon2i/argon2d because it is resistant to both
 * side-channel and GPU cracking attacks.
 */
export async function hashPassword(plainText: string): Promise<string> {
  const { ARGON2_MEMORY_COST, ARGON2_TIME_COST, ARGON2_PARALLELISM } = sessionEnv();

  return argon2.hash(plainText, {
    type: argon2.argon2id,
    memoryCost: ARGON2_MEMORY_COST,
    timeCost: ARGON2_TIME_COST,
    parallelism: ARGON2_PARALLELISM,
  });
}

export async function verifyPassword(passwordHash: string, plainText: string): Promise<boolean> {
  try {
    // No `type` option here: an Argon2 hash encodes its own variant in the
    // string, so verify detects it. Passing one would be rejected by the types.
    return await argon2.verify(passwordHash, plainText);
  } catch {
    // A malformed or truncated hash is a failed verification, never a crash.
    return false;
  }
}

/**
 * Burned on the "no such user" branch of login so that a request for an unknown
 * email takes roughly as long as one for a known email. Without it, response
 * timing alone would reveal which addresses have accounts.
 */
const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$Zm9vYmFyYmF6cXV4Zm9vYmFyYmF6cXV4';

export async function simulatePasswordVerification(plainText: string): Promise<void> {
  await verifyPassword(DUMMY_HASH, plainText);
}
