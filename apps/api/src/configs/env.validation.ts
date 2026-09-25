// env.validation.ts describes every environment variable the API needs.
// ConfigModule runs this at boot, so a missing secret is a startup crash with a
// readable message instead of an undefined value that surfaces hours later.
import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),

  // Railway injects PORT. coerce is needed because env values are always strings.
  PORT: z.coerce.number().default(3001),

  // Reference these in Railway as ${{Postgres.DATABASE_URL}} rather than pasting
  // the value, so a rotated password does not silently break the deploy.
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  // Long random values: openssl rand -base64 48
  // Access and refresh must differ, or a stolen access token can mint refreshes.
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('30d'),

  CORS_ORIGINS: z.string().default('http://localhost:3000'),

  // Used to build the return, cancel and notify URLs a payment provider needs.
  WEB_URL: z.string().default('http://localhost:3000'),
  API_URL: z.string().default('http://localhost:3001'),

  // Phase 0 does not use these yet. They are optional until the phase that needs
  // them, so a fresh clone boots without an ImageKit or PayHere account.
  IMAGEKIT_PUBLIC_KEY: z.string().optional(),
  IMAGEKIT_PRIVATE_KEY: z.string().optional(),
  IMAGEKIT_URL_ENDPOINT: z.string().optional(),
  PAYHERE_MERCHANT_ID: z.string().optional(),
  PAYHERE_SECRET: z.string().optional(),
  // 'true' points checkout at PayHere's sandbox. Anything else is live.
  PAYHERE_SANDBOX: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;
