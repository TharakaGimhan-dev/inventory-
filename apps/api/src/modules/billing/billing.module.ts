// billing.module.ts owns the plan catalogue, the metered usage and the quota
// guard's dependencies.
//
// Global, because the quota guard runs on routes in other modules and the
// services that write tenant data have to keep the counters in step.
import { Global, Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { Tenant } from '../tenant/models/tenant.model';
import { BillingController } from './controller/billing.controller';
import { Plan } from './models/plan.model';
import { UsageCounter } from './models/usage-counter.model';
import { PlanService } from './service/plan.service';
import { UsageService } from './service/usage.service';

@Global()
@Module({
  imports: [SequelizeModule.forFeature([Plan, UsageCounter, Tenant])],
  controllers: [BillingController],
  providers: [PlanService, UsageService],
  exports: [PlanService, UsageService, SequelizeModule],
})
export class BillingModule {}
