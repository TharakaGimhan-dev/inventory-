// login-attempts.service.ts locks an account after repeated failures.
//
// Rate limiting alone is not enough: it is keyed on the caller's address, and
// an attacker with a few hundred addresses gets a few hundred budgets against
// one account. This counts failures per account, so the defence follows the
// thing being attacked.
import { Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../configs/redis/redis.module';

/** Failures before the account stops answering. */
const MAX_FAILURES = 8;

/** How long a locked account stays locked. */
const LOCK_SECONDS = 15 * 60;

/** Failures older than this stop counting, so a typo months ago is not held. */
const WINDOW_SECONDS = 15 * 60;

@Injectable()
export class LoginAttemptsService {
  private readonly logger = new Logger('Security');

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  private key(email: string) {
    return `login:fail:${email.toLowerCase()}`;
  }

  private lockKey(email: string) {
    return `login:lock:${email.toLowerCase()}`;
  }

  /** Seconds remaining on a lock, or 0. */
  async lockedFor(email: string): Promise<number> {
    const ttl = await this.redis.ttl(this.lockKey(email));
    return ttl > 0 ? ttl : 0;
  }

  async recordFailure(email: string, ip: string | undefined): Promise<void> {
    const key = this.key(email);
    const failures = await this.redis.incr(key);

    // Set on the first failure only, so the window is measured from the first
    // attempt rather than sliding forward with each one - otherwise a slow
    // attacker keeps the window open indefinitely.
    if (failures === 1) await this.redis.expire(key, WINDOW_SECONDS);

    // A09:2025 - a failed login that is never written down is an attack nobody
    // can see afterwards. The email is logged because it is the account under
    // attack; the password never is.
    this.logger.warn(
      `Failed login for ${email} from ${ip ?? 'unknown'} (${failures}/${MAX_FAILURES})`,
    );

    if (failures >= MAX_FAILURES) {
      await this.redis.set(this.lockKey(email), '1', 'EX', LOCK_SECONDS);
      this.logger.error(
        `Locked ${email} for ${LOCK_SECONDS / 60} minutes after ${failures} failed attempts`,
      );
    }
  }

  /** Clears the count. Called on a successful sign-in. */
  async recordSuccess(email: string, ip: string | undefined): Promise<void> {
    await this.redis.del(this.key(email), this.lockKey(email));
    this.logger.log(`Sign-in for ${email} from ${ip ?? 'unknown'}`);
  }
}
