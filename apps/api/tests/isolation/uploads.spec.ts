// uploads.spec.ts covers photo uploads.
//
// The claims:
//   1. with no ImageKit keys the API says so, rather than signing uploads
//      ImageKit will reject
//   2. the signature is ImageKit's HMAC, and the private key never leaves
//   3. storage is reserved before a signature is issued, and the plan's limit
//      holds even when uploads race for the last bytes
//   4. an asset only carries photos from its own tenant's folder, and no more
//      of them than the plan allows
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { createHmac } from 'node:crypto';
import { Sequelize } from 'sequelize-typescript';
import { testDatabaseUrl } from './test-database';
import { PlatformRole, TenantRole } from '../../src/common/constants/roles';
import { runWithTenant, runWithoutTenantScope } from '../../src/common/context/tenant.context';
import { PlanLimitExceededException } from '../../src/common/exceptions/plan-limit.exception';
import { RolesGuard } from '../../src/common/guards/roles.guard';
import { TenantScopeHook } from '../../src/common/services/tenant-scope.hook';
import { AuthenticatedUser } from '../../src/common/types/authenticated-user';
import { Asset } from '../../src/modules/asset/models/asset.model';
import { AssetMovement } from '../../src/modules/asset/models/asset-movement.model';
import { Category } from '../../src/modules/asset/models/category.model';
import { Counter } from '../../src/modules/asset/models/counter.model';
import { Location } from '../../src/modules/asset/models/location.model';
import { AssetCodeService } from '../../src/modules/asset/service/asset-code.service';
import { AssetService } from '../../src/modules/asset/service/asset.service';
import { AuditEntry } from '../../src/modules/audit/models/audit-entry.model';
import { AuditService } from '../../src/modules/audit/service/audit.service';
import { PlanLimits } from '../../src/modules/billing/models/plan.model';
import { UsageCounter, UsageMetric } from '../../src/modules/billing/models/usage-counter.model';
import { FALLBACK_LIMITS, UNLIMITED } from '../../src/modules/billing/service/plan.service';
import { UsageService } from '../../src/modules/billing/service/usage.service';
import { UploadController } from '../../src/modules/upload/controller/upload.controller';
import {
  SIGNATURE_TTL_SECONDS, UploadService,
} from '../../src/modules/upload/service/upload.service';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const USER_A = '33333333-3333-4333-8333-333333333333';

const KEYS = {
  IMAGEKIT_PUBLIC_KEY: 'public_test_key',
  IMAGEKIT_PRIVATE_KEY: 'private_test_key_never_returned',
  // Trailing slash on purpose: the API must strip it, because clients build
  // the URL as urlEndpoint + path and every path starts with '/'.
  IMAGEKIT_URL_ENDPOINT: 'https://ik.imagekit.io/inventory-test/',
};

const MB = 1024 * 1024;

let sequelize: Sequelize;
let usage: UsageService;

// The limits the fake PlanService hands out. Each test sets what it needs.
let limits: PlanLimits;
const plans = { effectiveLimits: async () => limits } as any;

const asA = <T>(fn: () => T) =>
  runWithTenant({ tenantId: TENANT_A, userId: USER_A }, fn);

const uploads = (config: Record<string, string> = KEYS) =>
  new UploadService(new ConfigService(config), sequelize as any, usage, plans);

const entryUser: AuthenticatedUser = {
  id: USER_A,
  email: 'entry@example.test',
  tenantId: TENANT_A,
  role: TenantRole.ENTRY,
  platformRole: PlatformRole.NONE,
};

beforeAll(async () => {
  // ConfigService falls back to process.env, so a shell with real ImageKit
  // keys exported would otherwise decide the outcome of the "no keys" test.
  for (const key of Object.keys(KEYS)) delete process.env[key];

  sequelize = new Sequelize(testDatabaseUrl(), {
    dialect: 'postgres',
    logging: false,
    models: [Asset, AssetMovement, Location, Category, Counter, UsageCounter, AuditEntry],
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
  limits = { ...FALLBACK_LIMITS };

  await runWithoutTenantScope(async () => {
    await AuditEntry.destroy({ where: {}, truncate: true, cascade: true, hooks: false });
    await AssetMovement.destroy({ where: {}, truncate: true, cascade: true });
    await Asset.destroy({ where: {}, truncate: true, cascade: true, force: true });
    await Counter.destroy({ where: {}, truncate: true, cascade: true });
    await UsageCounter.destroy({ where: {}, truncate: true, cascade: true });
  });
});

describe('GET /uploads/config', () => {
  it('is off, with no endpoint, when no keys are set', () => {
    expect(uploads({}).publicConfig()).toEqual({ enabled: false, urlEndpoint: null });
  });

  it('is off when only some of the keys are set', () => {
    const { IMAGEKIT_PRIVATE_KEY, ...partial } = KEYS;
    expect(uploads(partial).publicConfig().enabled).toBe(false);
  });

  it('is on with all three, and gives the endpoint without a trailing slash', () => {
    expect(uploads().publicConfig()).toEqual({
      enabled: true,
      urlEndpoint: 'https://ik.imagekit.io/inventory-test',
    });
  });
});

describe('POST /uploads/sign', () => {
  const sign = (size = 2 * MB, service = uploads()) =>
    asA(() => service.sign(TENANT_A, { size, contentType: 'image/webp' }));

  it('answers 503 when ImageKit is not configured, and reserves nothing', async () => {
    await expect(sign(2 * MB, uploads({}))).rejects.toMatchObject({
      status: 503,
      message: 'Photo uploads are not configured yet',
    });

    expect(await usage.current(UsageMetric.STORAGE_BYTES, TENANT_A)).toBe(0);
  });

  it("returns ImageKit's HMAC-SHA1 of token + expire, keyed by the private key", async () => {
    const before = Math.floor(Date.now() / 1000);
    const signed = await sign();

    const expected = createHmac('sha1', KEYS.IMAGEKIT_PRIVATE_KEY)
      .update(signed.token + signed.expire)
      .digest('hex');

    expect(signed.signature).toBe(expected);
    expect(signed.publicKey).toBe(KEYS.IMAGEKIT_PUBLIC_KEY);

    // Under ImageKit's one-hour ceiling, and about half an hour out.
    expect(signed.expire - before).toBeGreaterThanOrEqual(SIGNATURE_TTL_SECONDS - 1);
    expect(signed.expire - before).toBeLessThan(60 * 60);
  });

  it('never returns the private key', async () => {
    const signed = await sign();
    expect(JSON.stringify(signed)).not.toContain(KEYS.IMAGEKIT_PRIVATE_KEY);
  });

  it("puts the file in the tenant's own folder, under a name the server chose", async () => {
    const signed = await sign();

    expect(signed.folder).toBe(`/tenants/${TENANT_A}`);
    expect(signed.fileName).toMatch(/^[0-9a-f-]{36}\.webp$/);
    expect(signed.path).toBe(`${signed.folder}/${signed.fileName}`);
    expect(signed.urlEndpoint).toBe('https://ik.imagekit.io/inventory-test');
  });

  it('issues a fresh token and file name every time', async () => {
    const [a, b] = [await sign(), await sign()];
    expect(a.token).not.toBe(b.token);
    expect(a.fileName).not.toBe(b.fileName);
  });

  it('reserves the declared size against storage', async () => {
    await sign(2 * MB);
    await sign(3 * MB);
    expect(await usage.current(UsageMetric.STORAGE_BYTES, TENANT_A)).toBe(5 * MB);
  });

  it('refuses with 402 once the plan is full, and reserves nothing for the refusal', async () => {
    limits.storageBytes = 5 * MB;

    await sign(4 * MB);
    await expect(sign(2 * MB)).rejects.toBeInstanceOf(PlanLimitExceededException);

    expect(await usage.current(UsageMetric.STORAGE_BYTES, TENANT_A)).toBe(4 * MB);

    // What is left can still be used.
    await sign(1 * MB);
    expect(await usage.current(UsageMetric.STORAGE_BYTES, TENANT_A)).toBe(5 * MB);
  });

  it('holds the limit when uploads race for the last bytes', async () => {
    // Room for exactly three 3 MB photos. A read-then-write check would let all
    // eight through; the condition on the increment lets exactly three.
    limits.storageBytes = 10 * MB;

    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () => sign(3 * MB)),
    );

    const granted = results.filter((r) => r.status === 'fulfilled');
    const refused = results.filter(
      (r) => r.status === 'rejected' && r.reason instanceof PlanLimitExceededException,
    );

    expect(granted).toHaveLength(3);
    expect(refused).toHaveLength(5);
    expect(await usage.current(UsageMetric.STORAGE_BYTES, TENANT_A)).toBe(9 * MB);
  });

  it('keeps counting on an unlimited plan', async () => {
    limits.storageBytes = UNLIMITED;
    await sign(8 * MB);
    expect(await usage.current(UsageMetric.STORAGE_BYTES, TENANT_A)).toBe(8 * MB);
  });

  it('is refused to a viewer and allowed to entry', () => {
    const guard = new RolesGuard(new Reflector());
    const context = (role: TenantRole, handler: Function) =>
      ({
        getHandler: () => handler,
        getClass: () => UploadController,
        switchToHttp: () => ({ getRequest: () => ({ user: { ...entryUser, role } }) }),
      }) as any;

    expect(() =>
      guard.canActivate(context(TenantRole.VIEWER, UploadController.prototype.sign)),
    ).toThrow(ForbiddenException);

    expect(
      guard.canActivate(context(TenantRole.ENTRY, UploadController.prototype.sign)),
    ).toBe(true);

    // The config route is open to a viewer: they still need to see photos.
    expect(
      guard.canActivate(context(TenantRole.VIEWER, UploadController.prototype.config)),
    ).toBe(true);
  });
});

describe('photos on an asset', () => {
  let assets: AssetService;

  beforeAll(() => {
    assets = new AssetService(
      Asset,
      AssetMovement,
      sequelize as any,
      new AssetCodeService(sequelize as any),
      new AuditService(AuditEntry),
      usage,
      plans,
    );
  });

  const own = (name = 'a1b2c3d4-0000-4000-8000-000000000001.jpg') =>
    `/tenants/${TENANT_A}/${name}`;
  const theirs = `/tenants/${TENANT_B}/a1b2c3d4-0000-4000-8000-000000000002.jpg`;

  const create = (imageIds?: string[]) =>
    asA(() =>
      assets.create({ name: 'Laptop', kind: 'asset', imageIds } as any, entryUser, {}),
    );

  const update = (id: string, imageIds: string[]) =>
    asA(() => assets.update(id, { imageIds } as any, entryUser, {}));

  describe('create', () => {
    it("accepts the tenant's own paths and stores them as sent", async () => {
      limits.photosPerAsset = 5;
      const asset = await create([own('one.jpg'), own('two.webp')]);
      expect(asset.imageIds).toEqual([own('one.jpg'), own('two.webp')]);
    });

    it("refuses another tenant's photo with 400", async () => {
      await expect(create([theirs])).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses a path that climbs out of the tenant folder', async () => {
      await expect(
        create([`/tenants/${TENANT_A}/../${TENANT_B}/x.jpg`]),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses an ImageKit file id or a bare name - only paths are stored', async () => {
      await expect(create(['652f1a3be4b0d1c5a8e9f000'])).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(create([`/tenants/${TENANT_A}/`])).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('refuses more photos than the plan allows with 402, and uses no code', async () => {
      limits.photosPerAsset = 1;

      await expect(create([own('one.jpg'), own('two.jpg')])).rejects.toMatchObject({
        status: 402,
        response: expect.objectContaining({ metric: 'photosPerAsset', limit: 1 }),
      });

      // Refused before the transaction, so the next capture is still TS-0001.
      const next = await create();
      expect(next.code).toBe('TS-0001');
    });

    it('allows any number up to the schema ceiling on an unlimited plan', async () => {
      limits.photosPerAsset = UNLIMITED;
      const ten = Array.from({ length: 10 }, (_, i) => own(`p${i}.jpg`));
      const asset = await create(ten);
      expect(asset.imageIds).toHaveLength(10);
    });
  });

  describe('the asset limit under a burst', () => {
    it('refuses the overflow with 402 instead of deadlocking the pool', async () => {
      // Three slots, eight captures - more than the pool's five connections.
      // The 402 used to read usage on a second connection while the first
      // was held, and a burst like this hung every request in it.
      limits.assets = 3;

      const results = await Promise.allSettled(
        Array.from({ length: 8 }, () => create()),
      );

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3);
      const refused = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
      expect(refused).toHaveLength(5);
      for (const r of refused) {
        expect(r.reason).toBeInstanceOf(PlanLimitExceededException);
      }
    }, 20_000);
  });

  describe('update', () => {
    it("accepts the tenant's own paths", async () => {
      limits.photosPerAsset = 5;
      const asset = await create();
      const updated = await update(asset.id, [own('after.png')]);
      expect(updated.imageIds).toEqual([own('after.png')]);
    });

    it("refuses another tenant's photo and leaves the asset as it was", async () => {
      const asset = await create([own()]);

      await expect(update(asset.id, [theirs])).rejects.toBeInstanceOf(BadRequestException);

      const reloaded = await asA(() => Asset.findByPk(asset.id));
      expect(reloaded!.imageIds).toEqual([own()]);
    });

    it('refuses more photos than the plan allows', async () => {
      limits.photosPerAsset = 1;
      const asset = await create();

      await expect(
        update(asset.id, [own('one.jpg'), own('two.jpg')]),
      ).rejects.toBeInstanceOf(PlanLimitExceededException);
    });
  });
});
