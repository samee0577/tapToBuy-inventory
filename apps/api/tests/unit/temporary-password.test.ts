import { describe, expect, it } from 'vitest';

import { passwordSchema } from '@inventory/shared';

import { generateTemporaryPassword } from '../../src/lib/temporary-password.js';

describe('temporary password generation', () => {
  it('always satisfies the shared password policy', () => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const password = generateTemporaryPassword();

      // The whole point of routing generation through the shared schema is that a
      // generated password can never be one the app would reject on the next login.
      expect(passwordSchema.safeParse(password).success).toBe(true);
    }
  });

  it('contains a lowercase letter, an uppercase letter and a digit', () => {
    const password = generateTemporaryPassword();

    expect(password).toMatch(/[a-z]/);
    expect(password).toMatch(/[A-Z]/);
    expect(password).toMatch(/\d/);
  });

  it('omits visually ambiguous characters', () => {
    // O/0, l/1/I and similar pairs are excluded so a password read aloud across a
    // counter, or copied off a phone screen, is not mistyped.
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const password = generateTemporaryPassword();

      expect(password).not.toMatch(/[O0lI1]/);
      expect(password).not.toMatch(/[^\w]/);
    }
  });

  it('produces a different password every time', () => {
    const generated = new Set<string>();

    for (let attempt = 0; attempt < 100; attempt += 1) {
      generated.add(generateTemporaryPassword());
    }

    expect(generated.size).toBe(100);
  });

  it('uses the requested length and clamps absurd values', () => {
    expect(generateTemporaryPassword(24)).toHaveLength(24);
    expect(generateTemporaryPassword(4)).toHaveLength(12);
    expect(generateTemporaryPassword(500)).toHaveLength(64);
  });

  it('does not always place the guaranteed characters first', () => {
    // Guards against the guaranteed-character positions being predictable, which
    // would materially reduce the entropy of the tail.
    const firstCharacters = new Set<string>();

    for (let attempt = 0; attempt < 200; attempt += 1) {
      firstCharacters.add(generateTemporaryPassword()[0] ?? '');
    }

    expect(firstCharacters.size).toBeGreaterThan(10);
  });
});
