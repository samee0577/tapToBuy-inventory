import { randomInt } from 'node:crypto';

/**
 * Generates a one-time password for an administrator to hand over.
 *
 * Alphabet is restricted to characters that are hard to confuse when read aloud
 * or copied off a screen in a shop (no 0/O, 1/l/I) and to characters that survive
 * a round trip through a keyboard with a non-Latin layout. Symbols are omitted
 * entirely: they are the first thing to trip up password managers and shift-key
 * mistakes, and 24 characters of entropy makes them unnecessary.
 *
 * Guaranteed to contain at least one lowercase letter, one uppercase letter and
 * one digit, so the result always satisfies the shared password policy.
 */
const LOWERCASE = 'abcdefghijkmnopqrstuvwxyz';
const UPPERCASE = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const DIGITS = '23456789';
const ALL = LOWERCASE + UPPERCASE + DIGITS;

const DEFAULT_LENGTH = 20;

export function generateTemporaryPassword(length = DEFAULT_LENGTH): string {
  const size = Math.max(12, Math.min(64, length));

  const characters = [
    LOWERCASE[randomInt(LOWERCASE.length)] ?? 'a',
    UPPERCASE[randomInt(UPPERCASE.length)] ?? 'A',
    DIGITS[randomInt(DIGITS.length)] ?? '2',
  ];

  while (characters.length < size) {
    characters.push(ALL[randomInt(ALL.length)] ?? 'a');
  }

  // Fisher-Yates with a CSPRNG so the guaranteed characters are not always in
  // the first three positions.
  for (let index = characters.length - 1; index > 0; index -= 1) {
    const swapWith = randomInt(index + 1);
    const held = characters[index] ?? '';
    characters[index] = characters[swapWith] ?? held;
    characters[swapWith] = held;
  }

  return characters.join('');
}
