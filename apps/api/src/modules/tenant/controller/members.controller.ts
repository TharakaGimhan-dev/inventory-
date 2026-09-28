// members.controller.ts: inviting people, changing their role, disabling and
// removing them (SAAS_SPEC.md §5.1, §7). Owner and admin only.
import {
  BadRequestException, Body, ConflictException, Controller, Delete,
  ForbiddenException, HttpCode, NotFoundException, Param, ParseUUIDPipe,
  Patch, Post, Req,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/sequelize';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import * as bcrypt from 'bcrypt';
import { Request } from 'express';
import { randomBytes } from 'node:crypto';
import { Op, Transaction } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { z } from 'zod';
import { AuditAction } from '../../../common/constants/asset';
import { MembershipStatus, TenantRole } from '../../../common/constants/roles';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { PlanLimitExceededException } from '../../../common/exceptions/plan-limit.exception';
import { MailService } from '../../../common/mail/mail.service';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { AuthenticatedUser } from '../../../common/types/authenticated-user';
import { AuditService } from '../../audit/service/audit.service';
import { UsageMetric } from '../../billing/models/usage-counter.model';
import { PlanService } from '../../billing/service/plan.service';
import { UsageService } from '../../billing/service/usage.service';
import { User } from '../../user/models/user.model';
import { Membership } from '../models/membership.model';
import { Tenant } from '../models/tenant.model';

// Owner is never granted here: an organisation has one, set at sign-up.
const grantable = z.enum([TenantRole.ADMIN, TenantRole.ENTRY, TenantRole.VIEWER]);

const inviteSchema = z.object({
  email: z.string().email().toLowerCase().trim(),
  role: grantable,
  firstName: z.string().min(1).max(80).trim().optional(),
  lastName: z.string().max(80).trim().optional(),
});

const updateMemberSchema = z
  .object({
    role: grantable,
    status: z.enum([MembershipStatus.ACTIVE, MembershipStatus.DISABLED]),
  })
  .partial()
  .refine((v) => v.role !== undefined || v.status !== undefined, {
    message: 'Nothing to change',
  });

@ApiTags('tenant')
@Controller('tenant/members')
export class MembersController {
  constructor(
    @InjectModel(Membership) private readonly memberships: typeof Membership,
    @InjectModel(User) private readonly users: typeof User,
    @InjectModel(Tenant) private readonly tenants: typeof Tenant,
    @InjectConnection() private readonly sequelize: Sequelize,
    private readonly plans: PlanService,
    private readonly usage: UsageService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
  ) {}

  /**
   * Adds someone to the organisation.
   *
   * Someone who already has an account joins at once. Someone new gets an
   * account with no usable password and an invited membership; they set a
   * password through "Forgot password", which also accepts the invitation
   * (AuthService.resetPassword) - one flow instead of two.
   */
  @Post('invite')
  @Roles(TenantRole.ADMIN)
  @ApiOperation({ summary: 'Invite someone - owner and admin only' })
  async invite(
    @CurrentUser() actor: AuthenticatedUser,
    @Body(new ZodValidationPipe(inviteSchema)) body: z.infer<typeof inviteSchema>,
    @Req() req: Request,
  ) {
    if (body.role === TenantRole.ADMIN && actor.role !== TenantRole.OWNER) {
      throw new ForbiddenException('Only the owner can make someone an admin');
    }

    const result = await this.sequelize.transaction(async (transaction) => {
      // Locks the organisation, so two invites at the limit can't both fit.
      const tenant = await this.tenants.findByPk(actor.tenantId, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (!tenant) throw new NotFoundException('Organisation not found');

      // Invited people count too: they are a seat already given out.
      const limits = await this.plans.effectiveLimits(actor.tenantId);
      if (!PlanService.isUnlimited(limits.members)) {
        const seats = await this.memberships.count({
          where: {
            tenantId: actor.tenantId,
            status: { [Op.in]: [MembershipStatus.ACTIVE, MembershipStatus.INVITED] },
          },
          transaction,
        });
        if (seats >= limits.members) {
          throw new PlanLimitExceededException(UsageMetric.MEMBERS, limits.members, seats);
        }
      }

      let user = await this.users.findOne({ where: { email: body.email }, transaction });
      const isNew = !user;
      if (user) {
        const existing = await this.memberships.findOne({
          where: { tenantId: actor.tenantId, userId: user.id },
          transaction,
        });
        if (existing) throw new ConflictException('That person is already in this organisation');
      } else {
        user = await this.users.create(
          {
            email: body.email,
            // Random and never shown: nobody can sign in with it. They set
            // a real one with a code sent to this address.
            passwordHash: await bcrypt.hash(randomBytes(32).toString('hex'), 12),
            firstName: body.firstName ?? body.email.split('@')[0].slice(0, 80),
            lastName: body.lastName ?? '',
          },
          { transaction },
        );
      }

      const membership = await this.memberships.create(
        {
          tenantId: actor.tenantId,
          userId: user.id,
          role: body.role,
          status: isNew ? MembershipStatus.INVITED : MembershipStatus.ACTIVE,
          invitedBy: actor.id,
          joinedAt: isNew ? null : new Date(),
        },
        { transaction },
      );
      if (!isNew) await this.usage.change(UsageMetric.MEMBERS, 1, transaction);

      await this.record(actor, membership.id, AuditAction.CREATE, null,
        { email: body.email, role: body.role, status: membership.status }, req, transaction);

      return { membership, tenantName: tenant.name, isNew };
    });

    await this.mail.send({
      to: body.email,
      subject: `You've been added to ${result.tenantName} on AssetSnap`,
      text: result.isNew
        ? `${result.tenantName} has invited you to AssetSnap.\n\n` +
          `To get started, open AssetSnap, tap "Forgot password?" and enter ` +
          `${body.email}. We'll email you a code to set your password.`
        : `You can now open ${result.tenantName} in AssetSnap. Sign in as ` +
          `usual and switch organisation under More.`,
    });

    return result.membership;
  }

  @Patch(':id')
  @Roles(TenantRole.ADMIN)
  @ApiOperation({ summary: "Change a member's role, or disable or re-enable them" })
  async update(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateMemberSchema))
    body: z.infer<typeof updateMemberSchema>,
    @Req() req: Request,
  ) {
    return this.sequelize.transaction(async (transaction) => {
      const membership = await this.target(actor, id, transaction);
      if (body.role === TenantRole.ADMIN && actor.role !== TenantRole.OWNER) {
        throw new ForbiddenException('Only the owner can make someone an admin');
      }
      if (membership.status === MembershipStatus.INVITED && body.status) {
        throw new BadRequestException(
          'An invitation is accepted by the person, not changed here - remove it instead',
        );
      }

      const before = { role: membership.role, status: membership.status };
      await membership.update(body, { transaction });

      // Disabled people don't hold a seat; re-enabled ones do again.
      if (before.status !== membership.status) {
        await this.usage.change(
          UsageMetric.MEMBERS,
          membership.status === MembershipStatus.ACTIVE ? 1 : -1,
          transaction,
        );
      }

      await this.record(actor, membership.id, AuditAction.UPDATE, before,
        { role: membership.role, status: membership.status }, req, transaction);
      return membership;
    });
  }

  @Delete(':id')
  @Roles(TenantRole.ADMIN)
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove someone from the organisation' })
  async remove(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    await this.sequelize.transaction(async (transaction) => {
      const membership = await this.target(actor, id, transaction);
      const before = { role: membership.role, status: membership.status };
      // The account stays - it may belong to other organisations, and its
      // name is on this one's history. Only the membership goes.
      await membership.destroy({ transaction });
      if (before.status === MembershipStatus.ACTIVE) {
        await this.usage.change(UsageMetric.MEMBERS, -1, transaction);
      }
      await this.record(actor, id, AuditAction.DELETE, before, null, req, transaction);
    });
  }

  /**
   * The membership being changed - never the owner's, never your own (no
   * locking yourself out), and an admin's only by the owner.
   */
  private async target(actor: AuthenticatedUser, id: string, transaction: Transaction) {
    const membership = await this.memberships.findOne({
      where: { id, tenantId: actor.tenantId },
      transaction,
    });
    // 404 for another organisation's id: the same reason as assets.
    if (!membership) throw new NotFoundException('Member not found');
    if (membership.role === TenantRole.OWNER) {
      throw new ForbiddenException("The owner's membership can't be changed here");
    }
    if (membership.userId === actor.id) {
      throw new ForbiddenException("You can't change your own membership");
    }
    if (membership.role === TenantRole.ADMIN && actor.role !== TenantRole.OWNER) {
      throw new ForbiddenException('Only the owner can change an admin');
    }
    return membership;
  }

  private record(
    actor: AuthenticatedUser,
    entityId: string,
    action: AuditAction,
    before: Record<string, unknown> | null,
    after: Record<string, unknown> | null,
    req: Request,
    transaction: Transaction,
  ) {
    return this.audit.record(
      {
        actorUserId: actor.id,
        entity: 'membership',
        entityId,
        action,
        before: before ?? undefined,
        after: after ?? undefined,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      },
      transaction,
    );
  }
}
