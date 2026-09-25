// feature.guard.ts refuses a route the tenant's plan does not include.
//
// Features are data on the plan row, the same as limits, so moving a capability
// between tiers is a row update rather than a deploy.
import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FEATURE_KEY, FeatureName } from '../decorators/feature.decorator';
import { AuthenticatedUser } from '../types/authenticated-user';
import { PlanService } from '../../modules/billing/service/plan.service';

const HUMAN: Record<FeatureName, string> = {
  csvExport: 'CSV export',
  reports: 'PDF and Excel reports',
  labels: 'QR label sheets',
  api: 'API access',
};

@Injectable()
export class FeatureGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly plans: PlanService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const feature = this.reflector.getAllAndOverride<FeatureName>(FEATURE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!feature) return true;

    const user = context
      .switchToHttp()
      .getRequest<{ user?: AuthenticatedUser }>().user;

    if (!user) return true;

    if (await this.plans.hasFeature(user.tenantId, feature)) return true;

    // 402, like a full plan: this is not a permission they lack, it is one
    // their plan does not carry, and it has an upgrade button.
    throw new HttpException(
      {
        statusCode: HttpStatus.PAYMENT_REQUIRED,
        error: 'Not included in your plan',
        message: `${HUMAN[feature]} is not included in your plan. Upgrade to use it.`,
        feature,
        upgradeUrl: '/billing',
      },
      HttpStatus.PAYMENT_REQUIRED,
    );
  }
}
