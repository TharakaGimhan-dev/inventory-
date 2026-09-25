// access.service.ts decides what a tenant may still do, given how they are
// paying.
//
// The rules are spec section 6.4, and the principle under all of them is that
// nobody loses their data for not paying. Access narrows; it never deletes, and
// export is never switched off.
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { TenantStatus } from '../../../common/constants/roles';
import { Tenant } from '../../tenant/models/tenant.model';
import { Subscription, SubscriptionStatus } from '../models/subscription.model';

export type AccessLevel = 'full' | 'read_only';

export type AccessDecision = {
  level: AccessLevel;
  /** Why, in words the app can show a customer directly. */
  reason: string | null;
  /** Days left before access narrows, when a countdown is running. */
  daysRemaining: number | null;
};

/** Grace after a trial ends with no payment. */
const TRIAL_GRACE_DAYS = 7;

/** Full access continues this long after a failed renewal. */
const DUNNING_DAYS = 14;

const DAY = 24 * 60 * 60 * 1000;

@Injectable()
export class AccessService {
  constructor(
    @InjectModel(Tenant) private readonly tenants: typeof Tenant,
    @InjectModel(Subscription)
    private readonly subscriptions: typeof Subscription,
  ) {}

  async decide(tenantId: string, now = new Date()): Promise<AccessDecision> {
    const tenant = await this.tenants.findByPk(tenantId);
    if (!tenant) return { level: 'read_only', reason: 'Unknown organisation', daysRemaining: null };

    if (tenant.status === TenantStatus.SUSPENDED) {
      return {
        level: 'read_only',
        reason: 'This organisation is suspended. Your data is safe and can still be exported.',
        daysRemaining: null,
      };
    }

    const subscription = await this.subscriptions.findOne({
      where: { tenantId, status: SubscriptionStatus.ACTIVE },
    });

    if (subscription) return { level: 'full', reason: null, daysRemaining: null };

    const pastDue = await this.subscriptions.findOne({
      where: { tenantId, status: SubscriptionStatus.PAST_DUE },
    });

    if (pastDue) {
      const since = pastDue.pastDueSince ?? pastDue.updatedAt;
      const days = daysBetween(since, now);

      if (days < DUNNING_DAYS) {
        // Full access through the window. A failed card is usually an expiry,
        // not a decision to leave, and locking someone out on day one loses the
        // customer over a problem they would have fixed.
        return {
          level: 'full',
          reason: 'A payment failed. Please update your payment details.',
          daysRemaining: DUNNING_DAYS - days,
        };
      }

      return {
        level: 'read_only',
        reason: 'Your subscription is unpaid. Your data is safe, and export stays available.',
        daysRemaining: null,
      };
    }

    // No subscription at all: a free tenant, or one whose trial has run out.
    if (tenant.status === TenantStatus.TRIALING && tenant.trialEndsAt) {
      const daysOver = daysBetween(tenant.trialEndsAt, now);

      if (daysOver < 0) {
        return { level: 'full', reason: null, daysRemaining: -daysOver };
      }

      if (daysOver < TRIAL_GRACE_DAYS) {
        return {
          level: 'full',
          reason: 'Your trial has ended. Choose a plan to keep adding items.',
          daysRemaining: TRIAL_GRACE_DAYS - daysOver,
        };
      }

      return {
        level: 'read_only',
        reason: 'Your trial has ended. Choose a plan to start adding items again.',
        daysRemaining: null,
      };
    }

    if (tenant.status === TenantStatus.CANCELLED) {
      return {
        level: 'read_only',
        reason: 'Your subscription was cancelled. Your data is kept, and export stays available.',
        daysRemaining: null,
      };
    }

    // An active tenant with no subscription row is on the free plan, which is
    // a real state and not a failure: plan limits do the constraining.
    return { level: 'full', reason: null, daysRemaining: null };
  }
}

function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - new Date(from).getTime()) / DAY);
}
