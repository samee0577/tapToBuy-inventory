import { describe, expect, it } from 'vitest';

import { hashPassword, verifyPassword } from '../../src/lib/password.js';

describe('Argon2id password hashing', () => {
  it('produces a hash that verifies against the original password', async () => {
    const hash = await hashPassword('CorrectHorse99');

    expect(hash).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(hash, 'CorrectHorse99')).toBe(true);
  });

  it('rejects the wrong password', async () => {
    const hash = await hashPassword('CorrectHorse99');

    expect(await verifyPassword(hash, 'correcthorse99')).toBe(false);
    expect(await verifyPassword(hash, 'CorrectHorse98')).toBe(false);
    expect(await verifyPassword(hash, '')).toBe(false);
  });

  it('salts each hash, so identical passwords differ on disk', async () => {
    const first = await hashPassword('SamePassword1');
    const second = await hashPassword('SamePassword1');

    expect(first).not.toBe(second);
    expect(await verifyPassword(first, 'SamePassword1')).toBe(true);
    expect(await verifyPassword(second, 'SamePassword1')).toBe(true);
  });

  it('never stores the plaintext', async () => {
    const hash = await hashPassword('PlaintextLeak99');

    expect(hash).not.toContain('PlaintextLeak99');
  });

  it('treats a malformed hash as a failed verification rather than throwing', async () => {
    // A corrupted hash in the database must not crash the login endpoint.
    await expect(verifyPassword('not-a-hash', 'anything')).resolves.toBe(false);
    await expect(verifyPassword('', 'anything')).resolves.toBe(false);
  });
});
