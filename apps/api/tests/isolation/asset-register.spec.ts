// asset-register.spec.ts is the Phase 2 acceptance suite.
//
// Two claims are tested against a real Postgres, because neither can be proved
// with a mock:
//
//   1. asset codes are unique per tenant, gapless, and never reused, even when
//      two captures race
//   2. audit entries cannot be updated or deleted by anyone
import { Sequelize } from 'sequelize-typescript';
import { Asset } from '../../src/modules/asset/models/asset.model';
import { AssetMovement } from '../../src/modules/asset/models/asset-movement.model';
import { Category } from '../../src/modules/asset/models/category.model';
import { Counter } from '../../src/modules/asset/models/counter.model';
import { Location } from '../../src/modules/asset/models/location.model';
import {
  AuditEntry, AuditEntryImmutableError,
} from '../../src/modules/audit/models/audit-entry.model';
import { AssetCodeService } from '../../src/modules/asset/service/asset-code.service';
import { TenantScopeHook } from '../../src/common/services/tenant-scope.hook';
import {
  runWithTenant, runWithoutTenantScope,
} from '../../src/common/context/tenant.context';
import { AuditAction } from '../../src/common/constants/asset';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const USER_A = '33333333-3333-4333-8333-333333333333';

let sequelize: Sequelize;
let codes: AssetCodeService;

const asA = <T>(fn: () => T) =>
  runWithTenant({ tenantId: TENANT_A, userId: USER_A }, fn);
const asB = <T>(fn: () => T) =>
  runWithTenant({ tenantId: TENANT_B, userId: USER_A }, fn);

beforeAll(async () => {
  sequelize = new Sequelize(process.env.DATABASE_URL!, {
    dialect: 'postgres',
    logging: false,
    models: [Asset, AssetMovement, Location, Category, Counter, AuditEntry],
  });

  new TenantScopeHook(sequelize as any).register(sequelize);

  await sequelize.sync({ force: true });

  // gen_random_uuid() comes from pgcrypto, installed by the first migration.
  // sync() builds tables straight from the models and never runs migrations,
  // so the suite installs it itself.
  await sequelize.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto";');

  codes = new AssetCodeService(sequelize as any);
});

afterAll(async () => {
  // cascade, because assets and movements reference each other; the empty
  // options object is required - Sequelize.drop() dereferences it.
  await sequelize.drop({ cascade: true });
  await sequelize.close();
});

beforeEach(async () => {
  await runWithoutTenantScope(async () => {
    await AuditEntry.destroy({ where: {}, truncate: true, cascade: true, hooks: false });
    await AssetMovement.destroy({ where: {}, truncate: true, cascade: true });
    await Asset.destroy({ where: {}, truncate: true, cascade: true, force: true });
    await Counter.destroy({ where: {}, truncate: true, cascade: true });
  });
});

const createAsset = (name: string) =>
  sequelize.transaction(async (t) => {
    const code = await codes.next(t);
    return Asset.create({ code, name } as any, { transaction: t });
  });

describe('asset codes (spec 5.4)', () => {
  it('starts at 0001 and counts up without gaps', async () => {
    const made = await asA(async () => {
      const out = [];
      for (let i = 0; i < 5; i++) out.push(await createAsset(`Item ${i}`));
      return out;
    });

    expect(made.map((a) => a.code)).toEqual([
      'TS-0001', 'TS-0002', 'TS-0003', 'TS-0004', 'TS-0005',
    ]);
  });

  it('each tenant has its own sequence', async () => {
    const a = await asA(() => createAsset('A laptop'));
    const b = await asB(() => createAsset('B laptop'));

    // Both get TS-0001. This is the whole reason the unique index is composite.
    expect(a.code).toBe('TS-0001');
    expect(b.code).toBe('TS-0001');
  });

  it('two simultaneous captures never receive the same code', async () => {
    // The race the row lock exists for. Without SELECT ... FOR UPDATE both
    // transactions read value 0 and both try to write TS-0001.
    const created = await asA(() =>
      Promise.all([
        createAsset('Parallel 1'),
        createAsset('Parallel 2'),
        createAsset('Parallel 3'),
        createAsset('Parallel 4'),
        createAsset('Parallel 5'),
      ]),
    );

    const issued = created.map((a) => a.code).sort();
    expect(new Set(issued).size).toBe(5);
    expect(issued).toEqual([
      'TS-0001', 'TS-0002', 'TS-0003', 'TS-0004', 'TS-0005',
    ]);
  });

  it('a failed capture does not consume a code', async () => {
    await asA(() => createAsset('First'));

    // The insert fails after the counter was read, inside the same transaction.
    await expect(
      asA(() =>
        sequelize.transaction(async (t) => {
          await codes.next(t);
          throw new Error('capture failed');
        }),
      ),
    ).rejects.toThrow('capture failed');

    // The rollback returned the code, so the sequence has no hole.
    const next = await asA(() => createAsset('Second'));
    expect(next.code).toBe('TS-0002');
  });

  it('a deleted asset does not release its code', async () => {
    const first = await asA(() => createAsset('Doomed laptop'));
    await asA(() => first.destroy());

    const next = await asA(() => createAsset('Replacement'));

    // TS-0001 is on a label stuck to the old laptop. Reissuing it would make
    // the label point at two different things.
    expect(next.code).toBe('TS-0002');
  });

  it('the counter never rewinds', async () => {
    await asA(async () => {
      for (let i = 0; i < 3; i++) await createAsset(`Item ${i}`);
      await Asset.destroy({ where: {}, force: true });
    });

    const afterWipe = await asA(() => createAsset('After everything went'));
    expect(afterWipe.code).toBe('TS-0004');
  });

  it('refuses to issue a code with no tenant in context', async () => {
    await expect(
      sequelize.transaction((t) => codes.next(t)),
    ).rejects.toThrow(/no tenant in context/i);
  });
});

describe('audit entries are append-only (spec 11.1 case 11)', () => {
  const write = () =>
    asA(() =>
      AuditEntry.create({
        actorUserId: USER_A,
        entity: 'asset',
        entityId: TENANT_A,
        action: AuditAction.CREATE,
        after: { code: 'TS-0001' },
      } as any),
    );

  it('can be written', async () => {
    const entry = await write();
    expect(entry.action).toBe(AuditAction.CREATE);
  });

  it('cannot be updated by anyone', async () => {
    const entry = await write();
    await expect(
      asA(() => entry.update({ action: AuditAction.DELETE })),
    ).rejects.toThrow(AuditEntryImmutableError);
  });

  it('cannot be deleted by anyone', async () => {
    const entry = await write();
    await expect(asA(() => entry.destroy())).rejects.toThrow(
      AuditEntryImmutableError,
    );
  });

  it('cannot be bulk-deleted either', async () => {
    await write();
    await expect(
      asA(() => AuditEntry.destroy({ where: {} })),
    ).rejects.toThrow(AuditEntryImmutableError);

    expect(await asA(() => AuditEntry.count())).toBe(1);
  });
});

describe('the register stays tenant-scoped', () => {
  it('one tenant never sees the other\'s assets', async () => {
    await asA(() => createAsset('A laptop'));
    await asB(() => createAsset('B laptop'));

    const seenByA = await asA(() => Asset.findAll());
    expect(seenByA).toHaveLength(1);
    expect(seenByA[0].name).toBe('A laptop');
  });

  it('a soft-deleted asset disappears from the register but keeps its row', async () => {
    const asset = await asA(() => createAsset('Written off'));
    await asA(() => asset.destroy());

    expect(await asA(() => Asset.count())).toBe(0);

    // Still there for last year's audit.
    const withDeleted = await asA(() => Asset.findAll({ paranoid: false }));
    expect(withDeleted).toHaveLength(1);
    expect(withDeleted[0].deletedAt).not.toBeNull();
  });
});
