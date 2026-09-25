// asset.service.ts owns the register's write paths.
//
// Every write is one transaction covering the row, its counter, its movement
// and its audit entry, so the trail can never disagree with the data.
import {
  ForbiddenException, Injectable, NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { AuditAction } from '../../../common/constants/asset';
import { TenantRole } from '../../../common/constants/roles';
import { AuthenticatedUser } from '../../../common/types/authenticated-user';
import { AuditService } from '../../audit/service/audit.service';
import { PlanLimitExceededException } from '../../../common/exceptions/plan-limit.exception';
import { UsageMetric } from '../../billing/models/usage-counter.model';
import { PlanService } from '../../billing/service/plan.service';
import { UsageService } from '../../billing/service/usage.service';
import { Asset } from '../models/asset.model';
import { AssetMovement } from '../models/asset-movement.model';
import {
  CreateAssetInput, ListAssetsQuery, MoveAssetInput, UpdateAssetInput,
} from '../schemas/asset.schema';
import { AssetCodeService } from './asset-code.service';

/**
 * Fields only admin and owner may write.
 *
 * replacementValue drives the insurance number, so an entry clerk correcting a
 * serial number must not be able to move it - spec section 11.1 case 8, carried
 * over from the Firebase rules.
 */
const ADMIN_ONLY_FIELDS = ['replacementValue'] as const;

export type RequestMeta = { ip?: string | null; userAgent?: string | null };

@Injectable()
export class AssetService {
  constructor(
    @InjectModel(Asset) private readonly assets: typeof Asset,
    @InjectModel(AssetMovement) private readonly movements: typeof AssetMovement,
    @InjectConnection() private readonly sequelize: Sequelize,
    private readonly codes: AssetCodeService,
    private readonly audit: AuditService,
    private readonly usage: UsageService,
    private readonly plans: PlanService,
  ) {}

  async list(query: ListAssetsQuery) {
    const where: Record<string, unknown> = {};

    if (query.status) where.status = query.status;
    if (query.kind) where.kind = query.kind;
    if (query.categoryId) where.categoryId = query.categoryId;
    if (query.locationId) where.locationId = query.locationId;

    if (query.q) {
      // iLike, so searching "laptop" finds "Laptop". Restricted to the three
      // fields a person actually searches by.
      const term = `%${query.q}%`;
      where[Op.or as any] = [
        { name: { [Op.iLike]: term } },
        { code: { [Op.iLike]: term } },
        { serialNumber: { [Op.iLike]: term } },
      ];
    }

    // The tenant filter is NOT added here. The query hook adds it to every
    // read, which is what makes it impossible to forget.
    const { rows, count } = await this.assets.findAndCountAll({
      where,
      limit: query.limit,
      offset: query.offset,
      order: [['createdAt', 'DESC']],
    });

    return { items: rows, total: count, limit: query.limit, offset: query.offset };
  }

  async findOne(id: string) {
    const asset = await this.assets.findByPk(id);
    // 404 rather than 403 for another tenant's id: the hook has already made it
    // invisible, and distinguishing the two would confirm the row exists.
    if (!asset) throw new NotFoundException('Asset not found');
    return asset;
  }

  async create(
    input: CreateAssetInput,
    user: AuthenticatedUser,
    meta: RequestMeta,
  ) {
    this.assertMayWriteAdminFields(input, user);

    const limits = await this.plans.effectiveLimits(user.tenantId);

    return this.sequelize.transaction(async (transaction) => {
      // The authoritative limit check, and it comes first: claiming the slot
      // before issuing a code means a refused capture does not consume one.
      // The quota guard has already rejected the obvious cases; this is what
      // holds when several captures arrive at the boundary together.
      if (!PlanService.isUnlimited(limits.assets)) {
        const claimed = await this.usage.increaseWithinLimit(
          UsageMetric.ASSETS,
          1,
          limits.assets,
          transaction,
        );

        if (claimed === null) {
          throw new PlanLimitExceededException(
            UsageMetric.ASSETS,
            limits.assets,
            await this.usage.current(UsageMetric.ASSETS, user.tenantId),
          );
        }
      } else {
        await this.usage.change(UsageMetric.ASSETS, 1, transaction);
      }

      // Inside the transaction, so a failed insert returns the code to the next
      // capture rather than leaving a gap in the sequence.
      const code = await this.codes.next(transaction);

      const asset = await this.assets.create(
        {
          ...input,
          code,
          quantity: input.quantity ?? 1,
          createdByUserId: user.id,
        } as any,
        { transaction },
      );

      await this.audit.record(
        {
          actorUserId: user.id,
          entity: 'asset',
          entityId: asset.id,
          action: AuditAction.CREATE,
          after: { code, name: asset.name, status: asset.status },
          ...meta,
        },
        transaction,
      );

      return asset;
    });
  }

  async update(
    id: string,
    input: UpdateAssetInput,
    user: AuthenticatedUser,
    meta: RequestMeta,
  ) {
    this.assertMayWriteAdminFields(input, user);

    return this.sequelize.transaction(async (transaction) => {
      const asset = await this.assets.findByPk(id, { transaction });
      if (!asset) throw new NotFoundException('Asset not found');

      const before = asset.toJSON() as Record<string, unknown>;

      // `code` is never in the schema, so it cannot arrive here. Spelled out
      // anyway: the code is printed on a label in the real world, and a rename
      // would point the label at nothing.
      await asset.update(input as any, { transaction });

      const changed = this.audit.diff(
        before,
        asset.toJSON() as Record<string, unknown>,
      );

      // No entry for a save that changed nothing - an audit log full of
      // no-op rows is one nobody reads.
      if (Object.keys(changed.after).length > 0) {
        await this.audit.record(
          {
            actorUserId: user.id,
            entity: 'asset',
            entityId: asset.id,
            action: AuditAction.UPDATE,
            before: changed.before,
            after: changed.after,
            ...meta,
          },
          transaction,
        );
      }

      return asset;
    });
  }

  async move(
    id: string,
    input: MoveAssetInput,
    user: AuthenticatedUser,
    meta: RequestMeta,
  ) {
    return this.sequelize.transaction(async (transaction) => {
      const asset = await this.assets.findByPk(id, { transaction });
      if (!asset) throw new NotFoundException('Asset not found');

      const fromLocationId = asset.locationId;
      const fromUserId = asset.assignedToUserId;

      const toLocationId =
        input.toLocationId === undefined ? fromLocationId : input.toLocationId;
      const toUserId =
        input.toUserId === undefined ? fromUserId : input.toUserId;

      await asset.update(
        { locationId: toLocationId, assignedToUserId: toUserId },
        { transaction },
      );

      // The movement row is the history; the columns on the asset are a cache
      // of the latest one, kept so the register list does not need a join.
      const movement = await this.movements.create(
        {
          assetId: asset.id,
          fromLocationId,
          toLocationId,
          fromUserId,
          toUserId,
          movedByUserId: user.id,
          note: input.note ?? null,
        } as any,
        { transaction },
      );

      await this.audit.record(
        {
          actorUserId: user.id,
          entity: 'asset',
          entityId: asset.id,
          action: AuditAction.MOVE,
          before: { locationId: fromLocationId, assignedToUserId: fromUserId },
          after: { locationId: toLocationId, assignedToUserId: toUserId },
          ...meta,
        },
        transaction,
      );

      return movement;
    });
  }

  async remove(id: string, user: AuthenticatedUser, meta: RequestMeta) {
    return this.sequelize.transaction(async (transaction) => {
      const asset = await this.assets.findByPk(id, { transaction });
      if (!asset) throw new NotFoundException('Asset not found');

      // Soft delete. A written-off laptop still has to appear in last year's
      // audit, and its code must stay taken so it is never reissued.
      await asset.destroy({ transaction });

      // The code stays taken, but the slot is released: a customer who disposes
      // of a laptop has room for its replacement without paying more.
      await this.usage.change(UsageMetric.ASSETS, -1, transaction);

      await this.audit.record(
        {
          actorUserId: user.id,
          entity: 'asset',
          entityId: asset.id,
          action: AuditAction.DELETE,
          before: { code: asset.code, name: asset.name },
          ...meta,
        },
        transaction,
      );
    });
  }

  async history(id: string) {
    await this.findOne(id);
    return this.movements.findAll({
      where: { assetId: id },
      order: [['movedAt', 'DESC']],
    });
  }

  /**
   * Blocks `entry` from the fields that carry money.
   *
   * Checked on the value being present rather than on it differing from the
   * current one: an entry clerk should not be sending the field at all.
   */
  private assertMayWriteAdminFields(
    input: Record<string, unknown>,
    user: AuthenticatedUser,
  ) {
    if (user.role === TenantRole.OWNER || user.role === TenantRole.ADMIN) return;

    for (const field of ADMIN_ONLY_FIELDS) {
      if (input[field] !== undefined) {
        throw new ForbiddenException(
          `Only an admin or owner may set ${field}`,
        );
      }
    }
  }
}
