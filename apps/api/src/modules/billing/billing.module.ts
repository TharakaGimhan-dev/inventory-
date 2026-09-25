// billing.module.ts holds the plan catalogue. Subscriptions, invoices and the
// PayHere provider arrive in Phase 5; the Plan model exists now because
// registration assigns the free plan.
import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { Plan } from './models/plan.model';

@Module({
  imports: [SequelizeModule.forFeature([Plan])],
  exports: [SequelizeModule],
})
export class BillingModule {}
