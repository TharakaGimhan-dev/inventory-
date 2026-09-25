// plan.service.ts answers "what is this tenant allowed to do".
//
// Limits are data, not constants: raising Free from 100 assets to 200 is a row
// update, not a deploy. A tenant may also carry an override, which is how the
// founding-customer discount is expressed without an `if` in the quota guard.
import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Tenant } from '../../tenant/models/tenant.model';
import { Plan, PlanLimits } from '../models/plan.model';

/** -1 means unlimited, everywhere. */
export const UNLIMITED = -1;

/**
 * Used when a tenant has no plan row at all - a tenant created before plans
 * were seeded, or a seed that has not run.
 *
 * Deliberately the free tier rather than unlimited: failing closed means a
 * misconfiguration costs a customer an upgrade prompt, while failing open means
 * it costs us the business model.
 */
export const FALLBACK_LIMITS: PlanLimits = {
  assets: 100,
  members: 2,
  locations: 5,
  photosPerAsset: 1,
  storageBytes: 200 * 1024 * 1024,
  auditRetentionDays: 30,
  customFields: 0,
};

@Injectable()
export class PlanService {
  private readonly logger = new Logger(PlanService.name);

  constructor(
    @InjectModel(Plan) private readonly plans: typeof Plan,
    @InjectModel(Tenant) private readonly tenants: typeof Tenant,
  ) {}

  listPublic() {
    return this.plans.findAll({
      where: { isPublic: true },
      order: [['sortOrder', 'ASC']],
    });
  }

  /** The tenant's plan row, or null if it has none. */
  async planFor(tenantId: string): Promise<Plan | null> {
    const tenant = await this.tenants.findByPk(tenantId);
    if (!tenant?.planId) return null;
    return this.plans.findByPk(tenant.planId);
  }

  /**
   * The limits actually in force: the plan's, with any per-tenant override
   * applied on top.
   */
  async effectiveLimits(tenantId: string): Promise<PlanLimits> {
    const tenant = await this.tenants.findByPk(tenantId);

    if (!tenant) {
      this.logger.warn(`No tenant ${tenantId}; falling back to free limits`);
      return FALLBACK_LIMITS;
    }

    const plan = tenant.planId ? await this.plans.findByPk(tenant.planId) : null;

    if (!plan) {
      this.logger.warn(
        `Tenant ${tenantId} has no plan; falling back to free limits`,
      );
    }

    const overrides =
      (tenant.settings?.limitOverrides as Partial<PlanLimits>) ?? {};

    return { ...FALLBACK_LIMITS, ...(plan?.limits ?? {}), ...overrides };
  }

  /**
   * Whether a tenant's plan includes a named feature.
   *
   * Free tiers get csvExport on purpose: the promise that a customer can
   * always take their data out is not a paid feature, it is the reason they
   * can trust us with it in the first place.
   */
  async hasFeature(tenantId: string, feature: string): Promise<boolean> {
    if (feature === 'csvExport') return true;

    const plan = await this.planFor(tenantId);
    return plan?.features?.[feature] === true;
  }

  static isUnlimited(limit: number): boolean {
    return limit === UNLIMITED;
  }
}
