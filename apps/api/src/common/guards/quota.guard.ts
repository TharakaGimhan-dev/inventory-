// quota.guard.ts stops a tenant at its plan limit.
//
// Runs after RolesGuard: being allowed to do something and having room to do it
// are separate questions, and a viewer hitting a create route should hear 403
// rather than an upgrade pitch.
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { QUOTA_KEY } from '../decorators/quota.decorator';
import { PlanLimitExceededException } from '../exceptions/plan-limit.exception';
import { AuthenticatedUser } from '../types/authenticated-user';
import { UsageMetric } from '../../modules/billing/models/usage-counter.model';
import { PlanService } from '../../modules/billing/service/plan.service';
import { UsageService } from '../../modules/billing/service/usage.service';

/** Which plan limit backs which metric. */
const LIMIT_FOR: Record<string, keyof Awaited<
  ReturnType<PlanService['effectiveLimits']>
>> = {
  [UsageMetric.ASSETS]: 'assets',
  [UsageMetric.MEMBERS]: 'members',
  [UsageMetric.LOCATIONS]: 'locations',
  [UsageMetric.STORAGE_BYTES]: 'storageBytes',
};

/**
 * Rejects a request that is already over its plan limit.
 *
 * This is the friendly check, not the authoritative one. It reads the counter
 * and cannot hold a limit when several requests arrive at the boundary at once
 * - they all read the same room before any of them writes. The services claim
 * the slot inside their transaction, where Postgres settles it; see
 * UsageService.increaseWithinLimit. The guard exists so the common case is
 * refused before any work is done, and so a route that is full answers the same
 * way whether or not it has a service behind it.
 */
@Injectable()
export class QuotaGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly plans: PlanService,
    private readonly usage: UsageService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const metric = this.reflector.getAllAndOverride<UsageMetric>(QUOTA_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!metric) return true;

    const user = context
      .switchToHttp()
      .getRequest<{ user?: AuthenticatedUser }>().user;

    if (!user) return true;

    const limits = await this.plans.effectiveLimits(user.tenantId);
    const limit = limits[LIMIT_FOR[metric]] as number;

    if (PlanService.isUnlimited(limit)) return true;

    const current = await this.usage.current(metric, user.tenantId);
    if (current < limit) return true;

    throw new PlanLimitExceededException(metric, limit, current);
  }
}
