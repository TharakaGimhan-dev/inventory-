// redis-throttler.storage.ts shares the rate-limit counters between instances.
//
// @nestjs/throttler stores counts in memory by default. That is correct for one
// process and wrong the moment the API is scaled: with three replicas, each
// keeps its own count, so a limit of ten becomes thirty and a load balancer
// spreads an attacker's attempts across all of them.
//
// Written against the ioredis client the app already has rather than pulling in
// another package. The interface is one method, and a dependency added to a
// security control is itself a supply-chain risk (OWASP A03:2025).
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../configs/redis/redis.module';

@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger(RedisThrottlerStorage.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const hitKey = `throttle:${throttlerName}:${key}`;
    const blockKey = `throttle:block:${throttlerName}:${key}`;

    try {
      // One round trip. Reading the block, incrementing and reading both TTLs
      // separately would let a burst slip through between the calls.
      const [[, blockTtlRaw], [, hitsRaw], [, hitTtlRaw]] = (await this.redis
        .multi()
        .pttl(blockKey)
        .incr(hitKey)
        .pttl(hitKey)
        .exec()) as [unknown, number][];

      const blockTtl = Number(blockTtlRaw);
      const hits = Number(hitsRaw);
      let hitTtl = Number(hitTtlRaw);

      // Already blocked: report it without extending anything, so a client
      // hammering a blocked key cannot push its own unblock further away.
      if (blockTtl > 0) {
        return {
          totalHits: hits,
          timeToExpire: Math.ceil(hitTtl / 1000),
          isBlocked: true,
          timeToBlockExpire: Math.ceil(blockTtl / 1000),
        };
      }

      // -1 means the key exists with no expiry, which happens on the first
      // increment. Without this the counter would never reset.
      if (hitTtl < 0) {
        await this.redis.pexpire(hitKey, ttl);
        hitTtl = ttl;
      }

      if (hits > limit) {
        await this.redis.set(blockKey, '1', 'PX', blockDuration || ttl, 'NX');

        return {
          totalHits: hits,
          timeToExpire: Math.ceil(hitTtl / 1000),
          isBlocked: true,
          timeToBlockExpire: Math.ceil((blockDuration || ttl) / 1000),
        };
      }

      return {
        totalHits: hits,
        timeToExpire: Math.ceil(hitTtl / 1000),
        isBlocked: false,
        timeToBlockExpire: 0,
      };
    } catch (error) {
      // Redis is down. Fail OPEN, deliberately: the alternative is that a cache
      // outage locks every customer out of a tool they are standing in a store
      // room using. The account lockout in LoginAttemptsService also depends on
      // Redis, so this is logged loudly rather than passed over - losing both
      // at once is worth waking someone up for.
      this.logger.error(
        `Rate limiting is DEGRADED - Redis unavailable: ${(error as Error).message}`,
      );

      return { totalHits: 0, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 };
    }
  }
}
