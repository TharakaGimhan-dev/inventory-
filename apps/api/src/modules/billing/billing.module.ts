// billing.module.ts owns the plan catalogue, the metered usage and the quota
// guard's dependencies.
//
// Global, because the quota guard runs on routes in other modules and the
// services that write tenant data have to keep the counters in step.
import { Global, Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { Tenant } from '../tenant/models/tenant.model';
import { User } from '../user/models/user.model';
import { BillingController } from './controller/billing.controller';
import { WebhookController } from './controller/webhook.controller';
import { Invoice } from './models/invoice.model';
import { Plan } from './models/plan.model';
import { Subscription } from './models/subscription.model';
import { UsageCounter } from './models/usage-counter.model';
import { WebhookEvent } from './models/webhook-event.model';
import { PAYMENT_PROVIDER } from './providers/payment-provider.interface';
import { PayHereProvider } from './providers/payhere.provider';
import { AccessService } from './service/access.service';
import { DunningService } from './service/dunning.service';
import { InvoiceService } from './service/invoice.service';
import { PlanService } from './service/plan.service';
import { SubscriptionService } from './service/subscription.service';
import { UsageService } from './service/usage.service';

@Global()
@Module({
  imports: [
    SequelizeModule.forFeature([
      Plan, UsageCounter, Tenant, User, Subscription, Invoice, WebhookEvent,
    ]),
  ],
  controllers: [BillingController, WebhookController],
  providers: [
    PlanService,
    UsageService,
    AccessService,
    InvoiceService,
    SubscriptionService,
    DunningService,
    // The seam. Swapping PayHere for another gateway is a different class
    // bound to this token, not a change anywhere else in the app.
    { provide: PAYMENT_PROVIDER, useClass: PayHereProvider },
  ],
  exports: [
    PlanService, UsageService, AccessService, SubscriptionService,
    SequelizeModule,
  ],
})
export class BillingModule {}
