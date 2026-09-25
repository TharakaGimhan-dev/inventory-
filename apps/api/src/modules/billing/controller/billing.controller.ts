// billing.controller.ts shows what the tenant is on and how much of it is used.
//
// Subscribing and cancelling are Phase 5, with the payment provider. What
// exists here is what the app needs to render a plan screen and an upgrade
// prompt honestly.
import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { InjectModel } from '@nestjs/sequelize';
import { z } from 'zod';
import { TenantRole } from '../../../common/constants/roles';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { Public } from '../../../common/decorators/public.decorator';
import { AuthenticatedUser } from '../../../common/types/authenticated-user';
import { Tenant } from '../../tenant/models/tenant.model';
import { UsageMetric } from '../models/usage-counter.model';
import { AccessService } from '../service/access.service';
import { InvoiceService } from '../service/invoice.service';
import { PlanService } from '../service/plan.service';
import { SubscriptionService } from '../service/subscription.service';
import { UsageService } from '../service/usage.service';

const subscribeSchema = z.object({
  planCode: z.enum(['starter', 'business']),
});

@ApiTags('billing')
@Controller('billing')
export class BillingController {
  constructor(
    private readonly plans: PlanService,
    private readonly usage: UsageService,
    private readonly subscriptions: SubscriptionService,
    private readonly invoiceService: InvoiceService,
    private readonly access: AccessService,
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
    const [tenant, plan, limits, usage, subscription, access] = await Promise.all([
      this.tenants.findByPk(user.tenantId),
      this.plans.planFor(user.tenantId),
      this.plans.effectiveLimits(user.tenantId),
      this.usage.summary(user.tenantId),
      this.subscriptions.current(user.tenantId),
      this.access.decide(user.tenantId),
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
      subscription: subscription
        ? {
            id: subscription.id,
            status: subscription.status,
            currentPeriodEnd: subscription.currentPeriodEnd,
            cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
            amount: subscription.amount,
            currency: subscription.currency,
          }
        : null,
      // What they may still do, and why - so the app can warn before access
      // narrows rather than only after.
      access,
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

  @Post('subscribe')
  @Roles(TenantRole.OWNER)
  @HttpCode(200)
  @ApiOperation({ summary: 'Start a checkout for a paid plan - owner only' })
  subscribe(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(subscribeSchema))
    body: { planCode: 'starter' | 'business' },
  ) {
    // Returns what the browser posts to the provider. The plan does not change
    // here: only a verified webhook may activate a subscription, because a
    // return URL is a navigation and not a payment.
    return this.subscriptions.startCheckout(user.tenantId, user.id, body.planCode);
  }

  @Post('cancel')
  @Roles(TenantRole.OWNER)
  @HttpCode(200)
  @ApiOperation({ summary: 'Cancel at the end of the paid period - owner only' })
  cancel(@CurrentUser() user: AuthenticatedUser) {
    return this.subscriptions.cancel(user.tenantId);
  }

  @Get('invoices')
  @Roles(TenantRole.ADMIN)
  @ApiOperation({ summary: 'Invoice history' })
  invoices(@CurrentUser() user: AuthenticatedUser) {
    return this.invoiceService.list(user.tenantId);
  }
}

const LIMIT_KEY: Record<string, string> = {
  [UsageMetric.ASSETS]: 'assets',
  [UsageMetric.MEMBERS]: 'members',
  [UsageMetric.LOCATIONS]: 'locations',
};
