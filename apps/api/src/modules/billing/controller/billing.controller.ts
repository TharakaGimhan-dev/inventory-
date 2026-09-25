// billing.controller.ts shows what the tenant is on and how much of it is used.
//
// Subscribing and cancelling are Phase 5, with the payment provider. What
// exists here is what the app needs to render a plan screen and an upgrade
// prompt honestly.
import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { InjectModel } from '@nestjs/sequelize';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Public } from '../../../common/decorators/public.decorator';
import { AuthenticatedUser } from '../../../common/types/authenticated-user';
import { Tenant } from '../../tenant/models/tenant.model';
import { UsageMetric } from '../models/usage-counter.model';
import { PlanService } from '../service/plan.service';
import { UsageService } from '../service/usage.service';

@ApiTags('billing')
@Controller('billing')
export class BillingController {
  constructor(
    private readonly plans: PlanService,
    private readonly usage: UsageService,
    @InjectModel(Tenant) private readonly tenants: typeof Tenant,
  ) {}

  @Public()
  @Get('plans')
  @ApiOperation({ summary: 'The public price list' })
  list() {
    // Public: the pricing page is read by people who have not signed up yet.
    return this.plans.listPublic();
  }

  @Get('subscription')
  @ApiOperation({ summary: 'Current plan, limits and usage' })
  async current(@CurrentUser() user: AuthenticatedUser) {
    const [tenant, plan, limits, usage] = await Promise.all([
      this.tenants.findByPk(user.tenantId),
      this.plans.planFor(user.tenantId),
      this.plans.effectiveLimits(user.tenantId),
      this.usage.summary(user.tenantId),
    ]);

    return {
      tenant: {
        id: tenant?.id,
        name: tenant?.name,
        status: tenant?.status,
        trialEndsAt: tenant?.trialEndsAt,
      },
      plan: plan
        ? {
            code: plan.code,
            name: plan.name,
            priceMonthly: plan.priceMonthly,
            currency: plan.currency,
            features: plan.features,
          }
        : null,
      limits,
      usage,
      // Pre-computed so every client renders the same bar and the same warning
      // threshold, rather than each inventing its own arithmetic.
      metrics: [
        UsageMetric.ASSETS,
        UsageMetric.MEMBERS,
        UsageMetric.LOCATIONS,
      ].map((metric) => {
        const limit = (limits as Record<string, number>)[LIMIT_KEY[metric]];
        const used = usage[metric] ?? 0;
        return {
          metric,
          used,
          limit,
          unlimited: PlanService.isUnlimited(limit),
          remaining: PlanService.isUnlimited(limit)
            ? null
            : Math.max(limit - used, 0),
        };
      }),
    };
  }
}

const LIMIT_KEY: Record<string, string> = {
  [UsageMetric.ASSETS]: 'assets',
  [UsageMetric.MEMBERS]: 'members',
  [UsageMetric.LOCATIONS]: 'locations',
};
