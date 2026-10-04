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

/** Comma-separated list of allowed image formats, e.g. "jpg,jpeg,png,webp". */
const formatList = z
  .string()
  .default('jpg,jpeg,png,webp')
  .transform((value) =>
    value
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => entry.length > 0),
  )
  .refine((entries) => entries.length > 0, {
    message: 'CLOUDINARY_ALLOWED_FORMATS must list at least one format',
  });

/**
 * Only the settings required to boot are parsed eagerly. Feature-specific
 * credentials are validated lazily on first use, so a misconfigured Cloudinary
 * account produces one actionable error at upload time instead of a crash loop
 * that takes the whole API offline.
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

/**
 * Cloudinary credentials.
 *
 * CLOUDINARY_API_SECRET is what makes a signed upload trustworthy: the browser is
 * handed a signature over a fixed parameter set and nothing else, so it cannot add
 * parameters of its own. The secret never leaves the server, which is why the
 * upload can be validated without proxying the file through Express.
 */
const cloudinarySchema = z.object({
  CLOUDINARY_CLOUD_NAME: z.string().min(1, 'CLOUDINARY_CLOUD_NAME is required').max(64),
  CLOUDINARY_API_KEY: z.string().min(8, 'CLOUDINARY_API_KEY looks too short').max(64),
  CLOUDINARY_API_SECRET: z.string().min(16, 'CLOUDINARY_API_SECRET looks too short').max(128),
  CLOUDINARY_UPLOAD_FOLDER: z.string().min(1).max(64).default('products'),
  CLOUDINARY_MAX_UPLOAD_BYTES: z.coerce.number().int().min(1_024).max(26_214_400).default(5_242_880),
  CLOUDINARY_MIN_DIMENSION: z.coerce.number().int().min(1).max(10_000).default(400),
  CLOUDINARY_MAX_DIMENSION: z.coerce.number().int().min(100).max(20_000).default(6_000),
  CLOUDINARY_ALLOWED_FORMATS: formatList,
});

export type BaseEnv = z.infer<typeof baseSchema>;
export type SessionEnv = z.infer<typeof sessionSchema>;
export type GoogleEnv = z.infer<typeof googleSchema>;
export type CloudinaryEnv = z.infer<typeof cloudinarySchema>;
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
export const cloudinaryEnv = lazyFeature('cloudinary', cloudinarySchema);
export const databaseEnv = lazyFeature('database', databaseSchema);
