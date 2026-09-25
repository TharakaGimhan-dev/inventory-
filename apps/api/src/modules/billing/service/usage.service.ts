// usage.service.ts keeps the metered numbers.
//
// Every change runs inside the caller's transaction, so a capture that rolls
// back does not leave the tenant one asset closer to its limit.
import { Injectable, Logger } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { QueryTypes, Transaction } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { getCurrentTenantId } from '../../../common/context/tenant.context';
import { CURRENT_PERIOD, UsageMetric } from '../models/usage-counter.model';

@Injectable()
export class UsageService {
  private readonly logger = new Logger(UsageService.name);

  constructor(@InjectConnection() private readonly sequelize: Sequelize) {}

  /**
   * Adds `delta` to a metric and returns the new value.
   *
   * One statement, for the same reason the asset-code counter is one: a read
   * followed by a write has a window where two concurrent captures both see
   * the same number and a tenant slips one past its limit.
   */
  async change(
    metric: UsageMetric,
    delta: number,
    transaction: Transaction,
    period = CURRENT_PERIOD,
    tenantId = getCurrentTenantId(),
  ): Promise<number> {
    if (!tenantId) {
      throw new Error('Cannot change usage with no tenant in context');
    }

    const rows = await this.sequelize.query<{ value: string }>(
      `INSERT INTO usage_counters ("id","tenantId","metric","period","value","createdAt","updatedAt")
       VALUES (gen_random_uuid(), :tenantId, :metric, :period, GREATEST(:delta, 0), NOW(), NOW())
       ON CONFLICT ("tenantId","metric","period")
       DO UPDATE SET
         -- GREATEST keeps a counter from going negative if a decrement is
         -- ever replayed; a negative usage would silently hand out free quota.
         "value" = GREATEST(usage_counters."value" + :delta, 0),
         "updatedAt" = NOW()
       RETURNING "value"`,
      {
        replacements: { tenantId, metric, period, delta },
        type: QueryTypes.SELECT,
        transaction,
      },
    );

    return Number(rows[0]?.value ?? 0);
  }

  /**
   * Increments a metric only if the result stays within `limit`.
   * Returns the new value, or null when the increment would exceed it.
   *
   * This is where a plan limit is actually enforced. The quota guard checks
   * first, but a guard cannot hold a limit under concurrency: it reads the
   * counter, and every request that read it before any of them wrote sees the
   * same room and is waved through. Eight simultaneous captures against one
   * remaining slot all passed, and the tenant ended up over its plan.
   *
   * Postgres settles it instead. The WHERE on the DO UPDATE is evaluated while
   * the row is locked, so exactly one of those eight increments succeeds and
   * the rest update nothing and return no row.
   */
  async increaseWithinLimit(
    metric: UsageMetric,
    delta: number,
    limit: number,
    transaction: Transaction,
    period = CURRENT_PERIOD,
    tenantId = getCurrentTenantId(),
  ): Promise<number | null> {
    if (!tenantId) {
      throw new Error('Cannot change usage with no tenant in context');
    }

    // The insert branch writes `delta` as the first value, so a limit smaller
    // than the increment could never be satisfied by it.
    if (delta > limit) return null;

    const rows = await this.sequelize.query<{ value: string }>(
      `INSERT INTO usage_counters ("id","tenantId","metric","period","value","createdAt","updatedAt")
       VALUES (gen_random_uuid(), :tenantId, :metric, :period, :delta, NOW(), NOW())
       ON CONFLICT ("tenantId","metric","period")
       DO UPDATE SET
         "value" = usage_counters."value" + :delta,
         "updatedAt" = NOW()
       WHERE usage_counters."value" + :delta <= :limit
       RETURNING "value"`,
      {
        replacements: { tenantId, metric, period, delta, limit },
        type: QueryTypes.SELECT,
        transaction,
      },
    );

    // No row means the WHERE rejected it: the tenant is full.
    return rows.length > 0 ? Number(rows[0].value) : null;
  }

  /** The current value of one metric. Zero when nothing has been counted yet. */
  async current(
    metric: UsageMetric,
    tenantId = getCurrentTenantId(),
    period = CURRENT_PERIOD,
  ): Promise<number> {
    if (!tenantId) return 0;

    const rows = await this.sequelize.query<{ value: string }>(
      `SELECT "value" FROM usage_counters
       WHERE "tenantId" = :tenantId AND "metric" = :metric AND "period" = :period`,
      {
        replacements: { tenantId, metric, period },
        type: QueryTypes.SELECT,
      },
    );

    return Number(rows[0]?.value ?? 0);
  }

  /** Every metric for a tenant, for the /billing/subscription screen. */
  async summary(tenantId: string): Promise<Record<string, number>> {
    const rows = await this.sequelize.query<{ metric: string; value: string }>(
      `SELECT "metric", "value" FROM usage_counters
       WHERE "tenantId" = :tenantId AND "period" = :period`,
      {
        replacements: { tenantId, period: CURRENT_PERIOD },
        type: QueryTypes.SELECT,
      },
    );

    const out: Record<string, number> = {};
    for (const metric of Object.values(UsageMetric)) out[metric] = 0;
    for (const row of rows) out[row.metric] = Number(row.value);
    return out;
  }

  /**
   * Recounts a tenant's metrics from the source tables.
   *
   * A counter is an optimisation, and optimisations drift - a crashed process
   * between the write and the increment, a row inserted by a migration, a bug.
   * Running this nightly means drift is corrected rather than accumulating into
   * a customer who cannot add an asset they are entitled to.
   */
  async reconcile(tenantId: string): Promise<Record<string, number>> {
    const counts = await this.sequelize.query<{
      assets: string;
      locations: string;
      members: string;
    }>(
      `SELECT
         (SELECT COUNT(*) FROM assets WHERE "tenantId" = :tenantId AND "deletedAt" IS NULL) AS assets,
         (SELECT COUNT(*) FROM locations WHERE "tenantId" = :tenantId AND "isActive" = true) AS locations,
         (SELECT COUNT(*) FROM memberships WHERE "tenantId" = :tenantId AND "status" = 'active') AS members`,
      { replacements: { tenantId }, type: QueryTypes.SELECT },
    );

    const truth = {
      [UsageMetric.ASSETS]: Number(counts[0]?.assets ?? 0),
      [UsageMetric.LOCATIONS]: Number(counts[0]?.locations ?? 0),
      [UsageMetric.MEMBERS]: Number(counts[0]?.members ?? 0),
    };

    await this.sequelize.transaction(async (transaction) => {
      for (const [metric, value] of Object.entries(truth)) {
        await this.sequelize.query(
          `INSERT INTO usage_counters ("id","tenantId","metric","period","value","createdAt","updatedAt")
           VALUES (gen_random_uuid(), :tenantId, :metric, :period, :value, NOW(), NOW())
           ON CONFLICT ("tenantId","metric","period")
           DO UPDATE SET "value" = :value, "updatedAt" = NOW()`,
          {
            replacements: {
              tenantId,
              metric,
              period: CURRENT_PERIOD,
              value,
            },
            transaction,
          },
        );
      }
    });

    return truth;
  }
}
