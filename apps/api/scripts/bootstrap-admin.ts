/**
 * Creates the first ADMIN account.
 *
 * Run once, on a machine that can reach the database:
 *   pnpm --filter @inventory/api user:bootstrap
 *
 * The password is prompted for interactively and never echoed, so it does not
 * end up in shell history or in a .env file. Deliberately not seeded: a default
 * password in a seed script is a well-known credential waiting to be exploited.
 */
import '../src/config/load-env.js';

import { createInterface, type Interface } from 'node:readline/promises';

import { stdin, stdout } from 'node:process';

import { UserRole } from '@prisma/client';
import type { ZodType } from 'zod';

import { emailSchema, nameSchema, passwordSchema } from '@inventory/shared';

import { hashPassword } from '../src/lib/password.js';
import { prisma } from '../src/lib/prisma.js';
import { logger } from '../src/lib/logger.js';

/** Hides keystrokes while reading a secret. Works on Windows terminals. */
async function promptSecret(rl: Interface, question: string): Promise<string> {
  const stdoutWrite = stdout.write.bind(stdout);

  stdout.write(question);
  (stdout as unknown as { write: (chunk: string) => boolean }).write = (chunk: string) => {
    if (chunk.includes('\n') || chunk.includes('\r')) {
      (stdout as unknown as { write: typeof stdoutWrite }).write = stdoutWrite;
      stdout.write('\n');
    }
    // Swallow every other character so nothing is displayed.
    return true;
  };

  const answer = await rl.question('');
  (stdout as unknown as { write: typeof stdoutWrite }).write = stdoutWrite;
  return answer;
}

async function ask(rl: Interface, question: string): Promise<string> {
  const answer = (await rl.question(question)).trim();
  return answer;
}

const MAX_ATTEMPTS = 5;

/**
 * Prompts until the value satisfies the schema.
 *
 * The parsed value is returned rather than the raw input, so the schema's own
 * trimming and lower-casing are applied. Passwords are deliberately not trimmed:
 * doing so would silently alter a password containing edge whitespace and make
 * it differ from what the operator typed into the confirmation prompt.
 */
async function askUntilValid(
  rl: Interface,
  question: string,
  schema: ZodType<string>,
  secret = false,
): Promise<string> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const raw = secret ? await promptSecret(rl, question) : await ask(rl, question);
    const parsed = schema.safeParse(raw);

    if (parsed.success) return parsed.data;

    console.error(`  ${parsed.error.issues[0]?.message ?? 'Invalid value.'}`);

    if (attempt === MAX_ATTEMPTS) break;
  }

  throw new Error(`No valid value entered after ${MAX_ATTEMPTS} attempts.`);
}

async function main(): Promise<void> {
  const rl = createInterface({ input: stdin, output: stdout });

  try {
    console.log('\nBootstrap the first administrator account.');
    console.log('This account can create staff accounts and manage users.\n');

    const existingAdmins = await prisma.user.count({
      where: { role: UserRole.ADMIN, isActive: true },
    });

    if (existingAdmins > 0 && !process.argv.includes('--force')) {
      console.log(
        `There ${existingAdmins === 1 ? 'is already 1 active administrator' : `are already ${existingAdmins} active administrators`}.`,
      );
      console.log('Create further accounts from the Users screen instead.');
      console.log('Pass --force only if you are deliberately adding another admin.\n');
      return;
    }

    const name = await askUntilValid(rl, 'Full name: ', nameSchema);
    const email = await askUntilValid(rl, 'Email: ', emailSchema);
    const password = await askUntilValid(rl, 'Password: ', passwordSchema, true);
    const confirmation = await promptSecret(rl, 'Confirm password: ');

    if (password !== confirmation) {
      throw new Error('Passwords did not match.');
    }

    const passwordHash = await hashPassword(password);

    const user = await prisma.user.create({
      data: { name, email, passwordHash, role: UserRole.ADMIN },
      select: { id: true, name: true, email: true, role: true },
    });

    logger.info({ targetUserId: user.id, role: user.role }, 'bootstrap admin created');
    console.log(`\nCreated administrator ${user.email} (${user.name}).`);
    console.log('Sign in at /login. Change this password from the Profile screen.\n');
  } finally {
    rl.close();
  }
}

main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\nBootstrap failed: ${message}\n`);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
