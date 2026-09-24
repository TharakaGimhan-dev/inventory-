// redis.health.ts is a custom Terminus indicator. Terminus ships checks for
// Sequelize but not for ioredis, so the PING lives here.
import { Inject, Injectable } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../../configs/redis/redis.module';

@Injectable()
export class RedisHealthIndicator {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly indicator: HealthIndicatorService,
  ) {}

  async isHealthy(key: string) {
    const check = this.indicator.check(key);

    try {
      // Races the PING so a hung socket reports unhealthy instead of holding the
      // health check open until the platform's own timeout fires.
      const pong = await Promise.race([
        this.redis.ping(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('redis ping timed out')), 3000),
        ),
      ]);

      return pong === 'PONG'
        ? check.up()
        : check.down({ message: `unexpected reply: ${pong}` });
    } catch (error) {
      return check.down({ message: (error as Error).message });
    }
  }
}
