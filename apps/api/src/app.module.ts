// app.module.ts is the root module. It wires infrastructure, the global guards
// and every feature module together.
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { FeatureGuard } from './common/guards/feature.guard';
import { QuotaGuard } from './common/guards/quota.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { SubscriptionAccessGuard } from './common/guards/subscription-access.guard';
import { SecurityModule } from './common/security/security.module';
import { throttlerConfig } from './common/security/throttler.config';
import { TenantContextInterceptor } from './common/middleware/tenant-context.interceptor';
import { TenantScopeHook } from './common/services/tenant-scope.hook';
import { envSchema } from './configs/env.validation';
import { DatabaseModule } from './configs/database/database.module';
import { RedisModule } from './configs/redis/redis.module';
import { ApiKeyModule } from './modules/apikey/apikey.module';
import { AssetModule } from './modules/asset/asset.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { BillingModule } from './modules/billing/billing.module';
import { ExportModule } from './modules/export/export.module';
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
    // Drives the daily dunning and usage-reconciliation job.
    ScheduleModule.forRoot(),
    SecurityModule,
    ThrottlerModule.forRootAsync(throttlerConfig),
    DatabaseModule,
    RedisModule,
    HealthModule,
    AuthModule,
    TenantModule,
    BillingModule,
    AuditModule,
    ApiKeyModule,
    // Before AssetModule, and it has to stay there. Nest matches routes in the
    // order controllers are registered, and AssetController has a @Get(':id') -
    // which otherwise swallows /assets/export and answers "uuid is expected".
    ExportModule,
    AssetModule,
  ],
  providers: [
    TenantScopeHook,

    // Order matters and is the order they are listed in.
    //
    // 0. Rate limit, before anything that costs work. A guessing attack should
    //    not get as far as a bcrypt comparison.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // 1. Authenticate - populates request.user, or rejects.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // 2. Authorize - reads request.user, so it must run after step 1.
    { provide: APP_GUARD, useClass: RolesGuard },
    // 3. Subscription state. Narrows an unpaid tenant to read-only, while
    //    never blocking a read and never blocking export.
    { provide: APP_GUARD, useClass: SubscriptionAccessGuard },
    // 4. Paid features. Like the quota guard, this answers 402 rather than
    //    403: the tenant is not forbidden, their plan does not include it.
    { provide: APP_GUARD, useClass: FeatureGuard },
    // 5. Plan limits. After authorization on purpose: a viewer hitting a create
    //    route should hear 403, not an upgrade pitch for something they would
    //    not be allowed to do anyway.
    { provide: APP_GUARD, useClass: QuotaGuard },
    // 6. Bind the tenant from the verified token, so every query below this
    //    point is scoped. It runs after both guards by construction:
    //    interceptors always run after guards in Nest's request pipeline.
    { provide: APP_INTERCEPTOR, useClass: TenantContextInterceptor },
  ],
})
export class AppModule {}
