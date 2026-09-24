// app.module.ts is the root module. It wires the infrastructure modules and every
// feature module together so Nest can build the dependency graph.
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './configs/database/database.module';
import { RedisModule } from './configs/redis/redis.module';
import { HealthModule } from './modules/health/health.module';
import { envSchema } from './configs/env.validation';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // The app refuses to boot on a bad or missing variable rather than failing
      // later on the first request that needs it.
      validate: (raw) => envSchema.parse(raw),
    }),
    DatabaseModule,
    RedisModule,
    HealthModule,
  ],
})
export class AppModule {}
