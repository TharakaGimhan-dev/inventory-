// throttler.config.ts sets the request budgets.
//
// Before this, forty wrong passwords in ten seconds were all answered, none
// were recorded, and nothing slowed down - an offline-speed guessing attack
// against a live login endpoint (OWASP A07:2025, Authentication Failures).
//
// Three named budgets rather than one: a login attempt and a register listing
// are not the same kind of request, and a single global number is either too
// loose for the first or too tight for the second.
import { ThrottlerAsyncOptions } from '@nestjs/throttler';
import { RedisThrottlerStorage } from './redis-throttler.storage';
import { SecurityModule } from './security.module';

export const THROTTLE = {
  /** Anything not otherwise named. Generous - this is a working tool. */
  DEFAULT: { name: 'default', ttl: 60_000, limit: 300 },

  /**
   * Password endpoints. Deliberately harsh: a person signing in mistypes two
   * or three times, never ten, and every attempt past that is a guess.
   */
  AUTH: { name: 'auth', ttl: 60_000, limit: 10 },

  /** Account creation, so one script cannot fill the database with tenants. */
  SIGNUP: { name: 'signup', ttl: 3_600_000, limit: 5 },
} as const;

export const throttlerConfig: ThrottlerAsyncOptions = {
  // Counters live in Redis, not in the process: with more than one replica,
  // in-memory counts give each replica its own budget, so a limit of ten
  // silently becomes ten times the replica count.
  imports: [SecurityModule],
  inject: [RedisThrottlerStorage],
  useFactory: (storage: RedisThrottlerStorage) => ({
    throttlers: [THROTTLE.DEFAULT],
    storage,
    // Behind Railway's proxy every request appears to come from the proxy, so
    // the real client address is read from the forwarded header. main.ts sets
    // `trust proxy` to make Express populate req.ip from it.
    getTracker: (req: { ip?: string }) => req.ip ?? 'unknown',
    errorMessage: 'Too many requests. Please wait a moment and try again.',
  }),
};
