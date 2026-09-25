// app.module.ts is the root module. It wires infrastructure, the global guards
// and every feature module together.
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { TenantContextInterceptor } from './common/middleware/tenant-context.interceptor';
import { TenantScopeHook } from './common/services/tenant-scope.hook';
import { envSchema } from './configs/env.validation';
import { DatabaseModule } from './configs/database/database.module';
import { RedisModule } from './configs/redis/redis.module';
import { AuthModule } from './modules/auth/auth.module';
import { BillingModule } from './modules/billing/billing.module';
import { HealthModule } from './modules/health/health.module';
import { TenantModule } from './modules/tenant/tenant.module';

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
    AuthModule,
    TenantModule,
    BillingModule,
  ],
  providers: [
    TenantScopeHook,

    // Order matters and is the order they are listed in.
    //
    // 1. Authenticate - populates request.user, or rejects.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // 2. Authorize - reads request.user, so it must run after step 1.
    { provide: APP_GUARD, useClass: RolesGuard },
    // 3. Bind the tenant from the verified token, so every query below this
    //    point is scoped. It runs after both guards by construction:
    //    interceptors always run after guards in Nest's request pipeline.
    { provide: APP_INTERCEPTOR, useClass: TenantContextInterceptor },
  ],
})
export class AppModule {}
