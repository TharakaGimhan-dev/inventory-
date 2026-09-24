// redis.module.ts creates the single Redis client the app shares.
// Phase 1 uses it for refresh tokens; later phases add rate limits and job queues.
import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

// A Symbol is a collision-proof Dependency Injection token.
export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const client = new Redis(config.get<string>('REDIS_URL')!, {
          // Without this the client queues commands forever when Redis is down,
          // turning an outage into hung requests instead of fast failures.
          maxRetriesPerRequest: 3,
          enableReadyCheck: true,
        });

        client.on('error', (err) =>
          console.error('[redis] connection error:', err.message),
        );

        return client;
      },
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
