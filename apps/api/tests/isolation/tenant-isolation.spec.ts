// tenant-isolation.spec.ts is the acceptance criterion for Phase 1 (spec 3.2).
//
// It is the successor to the Firebase project's tests/rules/ suite: the same
// question - can one customer reach another customer's data - asked of the
// layer that now answers it.
//
// These run against a real Postgres. A mock cannot prove a Sequelize hook fires.
import { Sequelize } from 'sequelize-typescript';
import {
  Column, DataType, Default, Model, PrimaryKey, Table,
} from 'sequelize-typescript';
import { TenantScopedModel } from '../../src/common/models/tenant-scoped.model';
import {
  runWithTenant, runWithoutTenantScope,
} from '../../src/common/context/tenant.context';
import {
  CrossTenantAccessError,
  MissingTenantContextError,
} from '../../src/common/services/tenant-scope.hook';

// A stand-in for the assets table Phase 2 adds. Using a throwaway model keeps
// this suite honest: it tests the mechanism, not one table's hand-written where.
@Table({ tableName: 'test_widgets', timestamps: false })
class Widget extends TenantScopedModel {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @Column({ type: DataType.UUID, allowNull: false })
  declare tenantId: string;

  @Column({ type: DataType.STRING, allowNull: false })
  declare code: string;

  @Column(DataType.STRING)
  declare name: string;
}

// An unscoped model, to prove the hook does not filter tables it should not.
@Table({ tableName: 'test_globals', timestamps: false })
class GlobalThing extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @Column(DataType.STRING)
  declare name: string;
}

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const USER_A = '33333333-3333-4333-8333-333333333333';
const USER_B = '44444444-4444-4444-8444-444444444444';

let sequelize: Sequelize;

const asTenantA = <T>(fn: () => T) =>
  runWithTenant({ tenantId: TENANT_A, userId: USER_A }, fn);
const asTenantB = <T>(fn: () => T) =>
  runWithTenant({ tenantId: TENANT_B, userId: USER_B }, fn);

beforeAll(async () => {
  sequelize = new Sequelize(process.env.DATABASE_URL!, {
    dialect: 'postgres',
    logging: false,
    models: [Widget, GlobalThing],
  });

  // Registers the same hooks the app registers, against this connection.
  // Duplicated from TenantScopeHook.onModuleInit rather than booting all of
  // Nest, because the hooks are the unit under test.
  const { TenantScopeHook } = await import(
    '../../src/common/services/tenant-scope.hook'
  );
  new TenantScopeHook(sequelize as any).register(sequelize);

  await sequelize.sync({ force: true });
});

afterAll(async () => {
  await sequelize.drop();
  await sequelize.close();
});

beforeEach(async () => {
  // Seeded outside any tenant context, so the fixtures themselves are not
  // shaped by the thing being tested.
  await runWithoutTenantScope(async () => {
    await Widget.destroy({ where: {}, truncate: true });
    await Widget.bulkCreate(
      [
        { tenantId: TENANT_A, code: 'TS-0001', name: 'A laptop' },
        { tenantId: TENANT_A, code: 'TS-0002', name: 'A chair' },
        { tenantId: TENANT_B, code: 'TS-0001', name: 'B laptop' },
      ],
      { hooks: false },
    );
  });
});

describe('spec 3.2 - tenant isolation', () => {
  it('case 1: a tenant reads only its own rows', async () => {
    const rowsA = await asTenantA(() => Widget.findAll());
    const rowsB = await asTenantB(() => Widget.findAll());

    expect(rowsA).toHaveLength(2);
    expect(rowsA.every((w) => w.tenantId === TENANT_A)).toBe(true);

    expect(rowsB).toHaveLength(1);
    expect(rowsB[0].name).toBe('B laptop');
  });

  it("case 1: fetching another tenant's row by id returns nothing", async () => {
    const bRow = await asTenantB(() => Widget.findOne());

    // Tenant A asks for a real id belonging to B, and gets null - the same
    // answer as for an id that does not exist. No existence leak.
    const found = await asTenantA(() => Widget.findByPk(bRow!.id));
    expect(found).toBeNull();
  });

  it('case 2: a client-supplied tenantId on create is rejected, not honoured', async () => {
    // The attack: tenant A posts a body carrying tenant B's id.
    await expect(
      asTenantA(() =>
        Widget.create({
          tenantId: TENANT_B,
          code: 'TS-0003',
          name: 'planted',
        } as any),
      ),
    ).rejects.toThrow(CrossTenantAccessError);

    // And nothing was written anywhere.
    const seenByB = await asTenantB(() =>
      Widget.findOne({ where: { code: 'TS-0003' } }),
    );
    expect(seenByB).toBeNull();
    expect(await asTenantA(() => Widget.count())).toBe(2);
  });

  it('case 2: a create with no tenantId is stamped with the context tenant', async () => {
    const created = await asTenantA(() =>
      Widget.create({ code: 'TS-0004', name: 'normal' } as any),
    );
    expect(created.tenantId).toBe(TENANT_A);
  });

  it('case 3: two tenants can both hold the same asset code', async () => {
    const a = await asTenantA(() => Widget.findOne({ where: { code: 'TS-0001' } }));
    const b = await asTenantB(() => Widget.findOne({ where: { code: 'TS-0001' } }));

    expect(a!.name).toBe('A laptop');
    expect(b!.name).toBe('B laptop');
    expect(a!.id).not.toBe(b!.id);
  });

  it('case 4: a query with no tenant context throws instead of returning all rows', async () => {
    // The failure that matters. If this ever returns rows, every customer's
    // data is one forgotten wrapper away from being served to anyone.
    await expect(Widget.findAll()).rejects.toThrow(MissingTenantContextError);
    await expect(Widget.count()).rejects.toThrow(MissingTenantContextError);
    await expect(
      Widget.create({ code: 'X', name: 'X' } as any),
    ).rejects.toThrow(MissingTenantContextError);
  });

  it('count is scoped, not just findAll', async () => {
    expect(await asTenantA(() => Widget.count())).toBe(2);
    expect(await asTenantB(() => Widget.count())).toBe(1);
  });

  it("update cannot reach across tenants", async () => {
    const bRow = await asTenantB(() => Widget.findOne());

    const [affected] = await asTenantA(() =>
      Widget.update({ name: 'hijacked' }, { where: { id: bRow!.id } }),
    );

    expect(affected).toBe(0);

    const after = await asTenantB(() => Widget.findByPk(bRow!.id));
    expect(after!.name).toBe('B laptop');
  });

  it('destroy cannot reach across tenants', async () => {
    const bRow = await asTenantB(() => Widget.findOne());

    const deleted = await asTenantA(() =>
      Widget.destroy({ where: { id: bRow!.id } }),
    );

    expect(deleted).toBe(0);
    expect(await asTenantB(() => Widget.count())).toBe(1);
  });

  it('a where clause naming another tenant is rejected, not quietly rewritten', async () => {
    // Returning tenant A's rows for a query that asked for B's would mean the
    // query silently meant something other than what it said.
    await expect(
      asTenantA(() => Widget.findAll({ where: { tenantId: TENANT_B } as any })),
    ).rejects.toThrow(CrossTenantAccessError);
  });

  it('unscoped models are left alone', async () => {
    // Proves the hook discriminates. If it filtered everything, users and
    // plans would break; if it filtered nothing, tenants would leak.
    await GlobalThing.create({ name: 'shared' });
    const rows = await GlobalThing.findAll();
    expect(rows).toHaveLength(1);
  });

  it('runWithoutTenantScope is the only way across, and it works', async () => {
    const all = await runWithoutTenantScope(() => Widget.findAll());
    expect(all).toHaveLength(3);
  });

  it('concurrent requests from two tenants do not bleed into each other', async () => {
    // AsyncLocalStorage, not a module-level variable. This is the test that
    // fails if someone "simplifies" the context into a singleton.
    const [a, b] = await Promise.all([
      asTenantA(async () => {
        await new Promise((r) => setTimeout(r, 10));
        return Widget.findAll();
      }),
      asTenantB(async () => Widget.findAll()),
    ]);

    expect(a.every((w) => w.tenantId === TENANT_A)).toBe(true);
    expect(b.every((w) => w.tenantId === TENANT_B)).toBe(true);
  });
});
