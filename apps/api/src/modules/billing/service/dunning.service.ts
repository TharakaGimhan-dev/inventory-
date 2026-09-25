// dunning.service.ts moves tenants through the states nobody clicks.
//
// A subscription does not expire because someone pressed a button; it expires
// because a date passed. Without a scheduled job, a trial that ended in March
// still reads as trialing in June.
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';
import { TenantStatus } from '../../../common/constants/roles';
import { Tenant } from '../../tenant/models/tenant.model';
import { Subscription, SubscriptionStatus } from '../models/subscription.model';
import { UsageService } from './usage.service';

const DAY = 24 * 60 * 60 * 1000;

@Injectable()
export class DunningService {
  private readonly logger = new Logger(DunningService.name);

  constructor(
    @InjectModel(Tenant) private readonly tenants: typeof Tenant,
    @InjectModel(Subscription) private readonly subscriptions: typeof Subscription,
    private readonly usage: UsageService,
  ) {}

  // Early morning, once a day. Nothing here is urgent to the minute, and a job
  // that recounts every tenant is better off away from the working day.
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async run() {
    await this.endExpiredPeriods();
    await this.reconcileUsage();
  }

  /**
   * Closes subscriptions whose paid period has run out.
   *
   * Only ones the customer already cancelled: a period ending without a
   * cancellation is a renewal, and whether it was paid is the webhook's news to
   * bring, not ours to assume.
   */
  private async endExpiredPeriods() {
    const expired = await this.subscriptions.findAll({
      where: {
        status: SubscriptionStatus.ACTIVE,
        cancelAtPeriodEnd: true,
        currentPeriodEnd: { [Op.lt]: new Date() },
      },
    });

    for (const subscription of expired) {
      await subscription.update({ status: SubscriptionStatus.CANCELLED });
      await this.tenants.update(
        { status: TenantStatus.CANCELLED },
        { where: { id: subscription.tenantId } },
      );

      this.logger.log(
        `Subscription ${subscription.id} ended at the close of its paid period`,
      );
    }
  }

  /**
   * Recounts usage for every tenant.
   *
   * Counters are an optimisation and optimisations drift - a crashed process
   * between a write and its increment, a row inserted by a migration. Left
   * alone, drift becomes a customer who cannot add an asset they are entitled
   * to, and they are right and we are wrong.
   */
  private async reconcileUsage() {
    const tenants = await this.tenants.findAll({ attributes: ['id'] });

    let corrected = 0;
    for (const tenant of tenants) {
      try {
        await this.usage.reconcile(tenant.id);
        corrected += 1;
      } catch (error) {
        // One bad tenant must not stop the rest being corrected.
        this.logger.error(
          `Could not reconcile usage for ${tenant.id}: ${(error as Error).message}`,
        );
      }
    }

    this.logger.log(`Reconciled usage for ${corrected} tenant(s)`);
  }
}
