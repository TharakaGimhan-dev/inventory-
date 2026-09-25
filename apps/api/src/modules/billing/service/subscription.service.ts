// subscription.service.ts owns the subscription lifecycle.
//
// The rule that shapes this file: **only a verified webhook may activate a
// subscription.** The app never marks itself paid because a browser came back
// from a checkout page - a return URL is a navigation, not a payment, and it is
// trivially forged by typing it.
import {
  BadRequestException, Inject, Injectable, Logger, NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection, InjectModel } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { TenantStatus } from '../../../common/constants/roles';
import { Tenant } from '../../tenant/models/tenant.model';
import { User } from '../../user/models/user.model';
import { Invoice, InvoiceStatus } from '../models/invoice.model';
import { Plan } from '../models/plan.model';
import {
  PaymentProviderName, Subscription, SubscriptionStatus,
} from '../models/subscription.model';
import { WebhookEvent } from '../models/webhook-event.model';
import {
  PAYMENT_PROVIDER, PaymentProvider, WebhookResult,
} from '../providers/payment-provider.interface';
import { InvoiceService } from './invoice.service';

const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

@Injectable()
export class SubscriptionService {
  private readonly logger = new Logger(SubscriptionService.name);

  constructor(
    @InjectModel(Subscription) private readonly subscriptions: typeof Subscription,
    @InjectModel(Tenant) private readonly tenants: typeof Tenant,
    @InjectModel(Plan) private readonly plans: typeof Plan,
    @InjectModel(User) private readonly users: typeof User,
    @InjectModel(WebhookEvent) private readonly events: typeof WebhookEvent,
    @InjectModel(Invoice) private readonly invoices: typeof Invoice,
    @InjectConnection() private readonly sequelize: Sequelize,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    private readonly invoiceService: InvoiceService,
    private readonly config: ConfigService,
  ) {}

  current(tenantId: string) {
    return this.subscriptions.findOne({
      where: { tenantId },
      include: [Plan],
      order: [['createdAt', 'DESC']],
    });
  }

  /**
   * Starts a checkout for a plan.
   *
   * Creates a pending subscription first, so the provider has our id to echo
   * back. The tenant's plan is NOT changed here - that waits for the webhook.
   */
  async startCheckout(tenantId: string, userId: string, planCode: string) {
    if (!this.provider.isConfigured()) {
      throw new BadRequestException(
        'Online payment is not configured yet. Please contact us for an invoice.',
      );
    }

    const [tenant, plan, user] = await Promise.all([
      this.tenants.findByPk(tenantId),
      this.plans.findOne({ where: { code: planCode } }),
      this.users.findByPk(userId),
    ]);

    if (!tenant || !user) throw new NotFoundException('Organisation not found');
    if (!plan) throw new NotFoundException(`No plan called ${planCode}`);
    if (Number(plan.priceMonthly) <= 0) {
      throw new BadRequestException('That plan is free; there is nothing to pay.');
    }

    const subscription = await this.subscriptions.create({
      tenantId,
      planId: plan.id,
      status: SubscriptionStatus.PENDING,
      provider: PaymentProviderName.PAYHERE,
      amount: plan.priceMonthly,
      currency: plan.currency,
    } as any);

    const webUrl = this.config.get<string>('WEB_URL', 'http://localhost:3000');
    const apiUrl = this.config.get<string>('API_URL', 'http://localhost:3001');

    return this.provider.createCheckout({
      tenantId,
      tenantName: tenant.name,
      subscriptionId: subscription.id,
      planCode: plan.code,
      planName: plan.name,
      amount: plan.priceMonthly,
      currency: plan.currency,
      customerEmail: user.email,
      customerFirstName: user.firstName,
      customerLastName: user.lastName,
      returnUrl: `${webUrl}/billing?payment=done`,
      cancelUrl: `${webUrl}/billing?payment=cancelled`,
      notifyUrl: `${apiUrl}/api/v1/webhooks/payhere`,
    });
  }

  /**
   * Processes a provider callback, exactly once.
   *
   * The caller has already verified the signature - an unverified body must
   * never reach this method.
   */
  async handleWebhook(result: WebhookResult): Promise<'processed' | 'duplicate'> {
    try {
      return await this.sequelize.transaction(async (transaction) => {
        // The unique index on (provider, eventId) is what makes this
        // exactly-once. Providers retry, and a retry processed twice extends a
        // subscription twice or writes a second invoice for one payment.
        await this.events.create(
          {
            provider: this.provider.name,
            eventId: result.eventId,
            payload: result.raw,
            outcome: result.outcome,
          } as any,
          { transaction },
        );

        await this.apply(result, transaction);
        return 'processed' as const;
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        // Already handled. Answering 200 is what stops the provider retrying.
        this.logger.log(`Ignoring duplicate ${result.eventId}`);
        return 'duplicate';
      }
      throw error;
    }
  }

  private async apply(result: WebhookResult, transaction: any) {
    if (!result.subscriptionId) return;

    const subscription = await this.subscriptions.findByPk(
      result.subscriptionId,
      { transaction },
    );

    if (!subscription) {
      this.logger.warn(`Callback for unknown subscription ${result.subscriptionId}`);
      return;
    }

    const tenant = await this.tenants.findByPk(subscription.tenantId, { transaction });

    switch (result.outcome) {
      case 'paid': {
        const now = new Date();

        await subscription.update(
          {
            status: SubscriptionStatus.ACTIVE,
            providerRef: result.subscriptionRef ?? subscription.providerRef,
            currentPeriodStart: now,
            currentPeriodEnd: new Date(now.getTime() + MONTH_MS),
            pastDueSince: null,
          },
          { transaction },
        );

        // The plan moves here, on payment - not at checkout. A customer who
        // abandons the payment page must not end up on a plan they never paid
        // for, and one whose card is declined must not keep the upgrade.
        await tenant?.update(
          { planId: subscription.planId, status: TenantStatus.ACTIVE },
          { transaction },
        );

        await this.invoiceService.create(
          {
            tenantId: subscription.tenantId,
            subscriptionId: subscription.id,
            amount: result.amount ?? subscription.amount,
            currency: result.currency ?? subscription.currency,
            status: InvoiceStatus.PAID,
            providerRef: result.providerRef,
            paidAt: now,
          },
          transaction,
        );
        break;
      }

      case 'failed': {
        await subscription.update(
          {
            status: SubscriptionStatus.PAST_DUE,
            // Only set on the first failure, so a second failed retry does not
            // restart the dunning clock and give an unpaying tenant forever.
            pastDueSince: subscription.pastDueSince ?? new Date(),
          },
          { transaction },
        );

        await tenant?.update({ status: TenantStatus.PAST_DUE }, { transaction });

        await this.invoiceService.create(
          {
            tenantId: subscription.tenantId,
            subscriptionId: subscription.id,
            amount: result.amount ?? subscription.amount,
            currency: result.currency ?? subscription.currency,
            status: InvoiceStatus.FAILED,
            providerRef: result.providerRef,
          },
          transaction,
        );
        break;
      }

      case 'cancelled': {
        await subscription.update(
          { status: SubscriptionStatus.CANCELLED, cancelledAt: new Date() },
          { transaction },
        );
        await tenant?.update({ status: TenantStatus.CANCELLED }, { transaction });
        break;
      }

      case 'chargeback': {
        // Money taken back. Access narrows immediately - unlike a failed
        // renewal, this is not a card that quietly expired.
        await subscription.update(
          { status: SubscriptionStatus.CANCELLED, cancelledAt: new Date() },
          { transaction },
        );
        await tenant?.update({ status: TenantStatus.SUSPENDED }, { transaction });

        await this.invoices.update(
          { status: InvoiceStatus.REFUNDED },
          { where: { subscriptionId: subscription.id, status: InvoiceStatus.PAID }, transaction },
        );
        break;
      }

      default:
        // pending and ignored: recorded, no state change.
        break;
    }
  }

  /**
   * Cancels at the end of the paid period.
   *
   * Not immediately: they have paid through the period, and taking the product
   * away the moment they cancel is a refund we did not give.
   */
  async cancel(tenantId: string) {
    const subscription = await this.subscriptions.findOne({
      where: { tenantId, status: SubscriptionStatus.ACTIVE },
    });

    if (!subscription) {
      throw new NotFoundException('There is no active subscription to cancel');
    }

    if (subscription.providerRef) {
      await this.provider.cancel(subscription.providerRef);
    }

    await subscription.update({ cancelAtPeriodEnd: true, cancelledAt: new Date() });

    return {
      cancelled: true,
      accessUntil: subscription.currentPeriodEnd,
      message:
        'Your plan stays active until the end of the period you have paid for. ' +
        'Your data is kept and can always be exported.',
    };
  }
}

function isUniqueViolation(error: unknown): boolean {
  const name = (error as { name?: string })?.name;
  return name === 'SequelizeUniqueConstraintError';
}
