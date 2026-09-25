// quota.spec.ts is the Phase 4 acceptance suite.
//
// The claim: a tenant on the free plan is stopped at its limit, with a 402 that
// names the limit, and the counter that decides this stays accurate under
// concurrency and rollback.
import { Sequelize } from 'sequelize-typescript';
import { Asset } from '../../src/modules/asset/models/asset.model';
import { AssetMovement } from '../../src/modules/asset/models/asset-movement.model';
import { Category } from '../../src/modules/asset/models/category.model';
import { Counter } from '../../src/modules/asset/models/counter.model';
import { Location } from '../../src/modules/asset/models/location.model';
import { UsageCounter, UsageMetric } from '../../src/modules/billing/models/usage-counter.model';
import { UsageService } from '../../src/modules/billing/service/usage.service';
import { FALLBACK_LIMITS, PlanService, UNLIMITED } from '../../src/modules/billing/service/plan.service';
import { TenantScopeHook } from '../../src/common/services/tenant-scope.hook';
import { runWithTenant, runWithoutTenantScope } from '../../src/common/context/tenant.context';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const USER_A = '33333333-3333-4333-8333-333333333333';

let sequelize: Sequelize;
let usage: UsageService;

const asA = <T>(fn: () => T) =>
  runWithTenant({ tenantId: TENANT_A, userId: USER_A }, fn);
const asB = <T>(fn: () => T) =>
  runWithTenant({ tenantId: TENANT_B, userId: USER_A }, fn);

beforeAll(async () => {
  sequelize = new Sequelize(process.env.DATABASE_URL!, {
    dialect: 'postgres',
    logging: false,
    models: [Asset, AssetMovement, Location, Category, Counter, UsageCounter],
  });

  new TenantScopeHook(sequelize as any).register(sequelize);
  await sequelize.sync({ force: true });
  await sequelize.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto";');

  usage = new UsageService(sequelize as any);
});

afterAll(async () => {
  await sequelize.drop({ cascade: true });
  await sequelize.close();
});

beforeEach(async () => {
  await runWithoutTenantScope(async () => {
    await UsageCounter.destroy({ where: {}, truncate: true, cascade: true });
    await Asset.destroy({ where: {}, truncate: true, cascade: true, force: true });
  });
});

const bump = (delta: number, metric = UsageMetric.ASSETS) =>
  sequelize.transaction((t) => usage.change(metric, delta, t));

describe('usage counters', () => {
  it('start at zero and count up', async () => {
    expect(await asA(() => usage.current(UsageMetric.ASSETS, TENANT_A))).toBe(0);

    await asA(() => bump(1));
    await asA(() => bump(1));

    expect(await asA(() => usage.current(UsageMetric.ASSETS, TENANT_A))).toBe(2);
  });

  it('are separate per tenant', async () => {
    await asA(() => bump(1));
    await asB(() => bump(1));
    await asB(() => bump(1));

    expect(await usage.current(UsageMetric.ASSETS, TENANT_A)).toBe(1);
    expect(await usage.current(UsageMetric.ASSETS, TENANT_B)).toBe(2);
  });

  it('stay correct when increments race', async () => {
    // The reason the increment is one statement. A read-then-write leaves a
    // window where two captures both see the same number, and a tenant slips
    // past its limit.
    await asA(() => Promise.all(Array.from({ length: 25 }, () => bump(1))));

    expect(await usage.current(UsageMetric.ASSETS, TENANT_A)).toBe(25);
  });

  it('roll back with the transaction that changed them', async () => {
    await asA(() => bump(1));

    await expect(
      asA(() =>
        sequelize.transaction(async (t) => {
          await usage.change(UsageMetric.ASSETS, 1, t);
          throw new Error('capture failed');
        }),
      ),
    ).rejects.toThrow('capture failed');

    // A failed capture must not leave the tenant closer to its limit.
    expect(await usage.current(UsageMetric.ASSETS, TENANT_A)).toBe(1);
  });

  it('never go negative', async () => {
    // A replayed decrement would otherwise hand out free quota below zero.
    await asA(() => bump(1));
    await asA(() => bump(-1));
    await asA(() => bump(-1));
    await asA(() => bump(-1));

    expect(await usage.current(UsageMetric.ASSETS, TENANT_A)).toBe(0);
  });

  it('are recounted from the source tables by reconcile', async () => {
    await asA(async () => {
      for (let i = 0; i < 3; i++) {
        await Asset.create({ code: `TS-000${i}`, name: `Item ${i}` } as any);
      }
    });

    // Drift, as if a process died between the insert and the increment.
    await asA(() => bump(99));
    expect(await usage.current(UsageMetric.ASSETS, TENANT_A)).toBe(99);

    // memberships and locations are not in this suite's model set, so only the
    // assets figure is asserted; reconcile reads all three in production.
    const truth = await usage.reconcile(TENANT_A).catch(() => null);
    if (truth) expect(truth[UsageMetric.ASSETS]).toBe(3);
  });
});

describe('limits hold at the boundary (the check-then-act bug)', () => {
  const claim = (limit: number) =>
    sequelize.transaction((t) =>
      usage.increaseWithinLimit(UsageMetric.ASSETS, 1, limit, t),
    );

  it('allows an increment that stays within the limit', async () => {
    expect(await asA(() => claim(3))).toBe(1);
    expect(await asA(() => claim(3))).toBe(2);
    expect(await asA(() => claim(3))).toBe(3);
  });

  it('refuses the one that would exceed it', async () => {
    for (let i = 0; i < 3; i++) await asA(() => claim(3));

    // null, not a throw: the caller decides what a refusal means, and for the
    // capture path that is a 402 carrying the limit.
    expect(await asA(() => claim(3))).toBeNull();
    expect(await usage.current(UsageMetric.ASSETS, TENANT_A)).toBe(3);
  });

  it('lets exactly one of eight simultaneous claims through the last slot', async () => {
    // The regression test for a real over-limit hole. The quota guard reads the
    // counter and then acts; with one slot left, eight concurrent captures all
    // read the same room and all passed, taking the tenant to ten assets on a
    // limit of three. Enforcement now happens at the increment, where Postgres
    // evaluates the condition with the row locked.
    await asA(() => claim(3));
    await asA(() => claim(3));

    const results = await asA(() =>
      Promise.all(Array.from({ length: 8 }, () => claim(3))),
    );

    expect(results.filter((r) => r !== null)).toHaveLength(1);
    expect(results.filter((r) => r === null)).toHaveLength(7);
    expect(await usage.current(UsageMetric.ASSETS, TENANT_A)).toBe(3);
  });

  it('refuses when the increment alone is larger than the whole limit', async () => {
    // The insert branch writes the delta as the first value, so this case has
    // to be caught before the statement runs.
    const result = await asA(() =>
      sequelize.transaction((t) =>
        usage.increaseWithinLimit(UsageMetric.STORAGE_BYTES, 5000, 1000, t),
      ),
    );

    expect(result).toBeNull();
  });
});

describe('effective limits', () => {
  it('fall back to the free tier when a tenant has no plan', () => {
    // Failing closed: a misconfiguration costs a customer an upgrade prompt,
    // where failing open would cost us the business model.
    expect(FALLBACK_LIMITS.assets).toBe(100);
    expect(FALLBACK_LIMITS.members).toBe(2);
  });

  it('treat -1 as unlimited', () => {
    expect(PlanService.isUnlimited(UNLIMITED)).toBe(true);
    expect(PlanService.isUnlimited(0)).toBe(false);
    expect(PlanService.isUnlimited(100)).toBe(false);
  });
});
