import './load-env.js';

import { z } from 'zod';

const booleanish = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true');

const csv = z
  .string()
  .default('http://localhost:5173,http://127.0.0.1:5173')
  .transform((value) =>
    value
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
  );

/**
 * Only the settings required to boot are parsed eagerly. Feature-specific
 * credentials are validated lazily on first use, so a misconfigured R2 bucket
 * produces one actionable error at upload time instead of a crash loop that
 * takes the whole API offline.
 */
const baseSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  CORS_ORIGINS: csv,
  TRUST_PROXY: booleanish.default('false'),
});

const databaseSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DIRECT_DATABASE_URL: z.string().optional(),
});

const sessionSchema = z.object({
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  SESSION_TTL_SECONDS: z.coerce.number().int().min(300).max(2_592_000).default(900),
  REGISTRATION_ENABLED: booleanish.default('false'),
  ARGON2_MEMORY_COST: z.coerce.number().int().min(8_192).max(1_048_576).default(19_456),
  ARGON2_TIME_COST: z.coerce.number().int().min(1).max(10).default(2),
  ARGON2_PARALLELISM: z.coerce.number().int().min(1).max(16).default(1),
  AUTH_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1_000).max(3_600_000).default(900_000),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(100).default(10),
});

const googleSchema = z.object({
  GOOGLE_CLIENT_ID: z.string().min(1, 'GOOGLE_CLIENT_ID is required'),
  GOOGLE_CLIENT_SECRET: z.string().min(1, 'GOOGLE_CLIENT_SECRET is required'),
});

const r2Schema = z.object({
  R2_ACCOUNT_ID: z.string().min(1, 'R2_ACCOUNT_ID is required'),
  R2_ACCESS_KEY_ID: z.string().min(1, 'R2_ACCESS_KEY_ID is required'),
  R2_SECRET_ACCESS_KEY: z.string().min(1, 'R2_SECRET_ACCESS_KEY is required'),
  R2_BUCKET_NAME: z.string().min(1, 'R2_BUCKET_NAME is required'),
  R2_PUBLIC_URL: z.string().url('R2_PUBLIC_URL must be an absolute URL'),
  R2_UPLOAD_MAX_BYTES: z.coerce.number().int().min(1_024).max(26_214_400).default(5_242_880),
  R2_UPLOAD_URL_TTL_SECONDS: z.coerce.number().int().min(60).max(900).default(300),
});

export type BaseEnv = z.infer<typeof baseSchema>;
export type SessionEnv = z.infer<typeof sessionSchema>;
export type GoogleEnv = z.infer<typeof googleSchema>;
export type R2Env = z.infer<typeof r2Schema>;
export type DatabaseEnv = z.infer<typeof databaseSchema>;

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
}

export class EnvironmentError extends Error {
  constructor(
    readonly feature: string,
    readonly issues: string[],
  ) {
    super(
      `Invalid environment configuration for "${feature}":\n${issues
        .map((issue) => `  - ${issue}`)
        .join('\n')}\n\nCopy .env.example to apps/api/.env and fill in these values.`,
    );
    this.name = 'EnvironmentError';
  }
}

function parseFeature<T extends z.ZodTypeAny>(
  feature: string,
  schema: T,
  source: NodeJS.ProcessEnv,
): z.infer<T> {
  const result = schema.safeParse(source);
  if (!result.success) {
    throw new EnvironmentError(feature, formatIssues(result.error).split('\n'));
  }
  return result.data;
}

/** Parses once on first access, then serves from memory. */
function lazyFeature<T extends z.ZodTypeAny>(feature: string, schema: T) {
  let cached: z.infer<T> | undefined;
  return (): z.infer<T> => {
    cached ??= parseFeature(feature, schema, process.env);
    return cached;
  };
}

function parseBase(source: NodeJS.ProcessEnv): BaseEnv {
  const result = baseSchema.safeParse(source);
  if (!result.success) {
    const error = new EnvironmentError('core', formatIssues(result.error).split('\n'));
    console.error(error.message);
    throw error;
  }
  return result.data;
}

export const env: BaseEnv = parseBase(process.env);

export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
export const isDeployed = process.env.VERCEL === '1' || process.env.AWS_LAMBDA_FUNCTION_NAME !== undefined;
export const corsOrigins: readonly string[] = env.CORS_ORIGINS;
export const trustProxy = env.TRUST_PROXY ? 1 : false;

export const sessionEnv = lazyFeature('session', sessionSchema);
export const googleEnv = lazyFeature('google', googleSchema);
export const r2Env = lazyFeature('r2', r2Schema);
export const databaseEnv = lazyFeature('database', databaseSchema);
