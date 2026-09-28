// tenant.controller.ts serves the current tenant and its members.
import {
  BadRequestException, Body, Controller, Get, NotFoundException, Patch, Put, Req,
} from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Request } from 'express';
import { Sequelize } from 'sequelize-typescript';
import { AuditAction } from '../../../common/constants/asset';
import { AuditService } from '../../audit/service/audit.service';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { InjectModel } from '@nestjs/sequelize';
import { Roles } from '../../../common/decorators/roles.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { TenantRole } from '../../../common/constants/roles';
import { AuthenticatedUser } from '../../../common/types/authenticated-user';
import { z } from 'zod';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { PlanService } from '../../billing/service/plan.service';
import { Membership } from '../models/membership.model';
import { Tenant } from '../models/tenant.model';
import { User } from '../../user/models/user.model';

/**
 * A field a tenant adds to every asset - a cost centre, a warranty contact,
 * whatever this organisation happens to track. Definitions live on the tenant
 * so adding one is a settings change, not a migration.
 */
const customFieldsSchema = z.object({
  fields: z
    .array(
      z.object({
        // Lower-case and underscored, because it becomes a JSON key on every
        // asset and a column heading in the export.
        key: z
          .string()
          .min(1)
          .max(40)
          .regex(/^[a-z][a-z0-9_]*$/, 'Use lower-case letters, digits and underscores'),
        label: z.string().min(1).max(80).trim(),
        type: z.enum(['text', 'number', 'date', 'select']),
        options: z.array(z.string().max(60)).max(50).optional(),
        required: z.boolean().default(false),
      }),
    )
    .max(50),
});

type CustomField = z.infer<typeof customFieldsSchema>['fields'][number];

// The same limits as sign-up (auth.schema.ts), so a name that could be
// registered can also be kept.
const updateMeSchema = z
  .object({
    firstName: z.string().min(1).max(80).trim(),
    lastName: z.string().min(1).max(80).trim(),
  })
  .partial()
  .refine((v) => v.firstName !== undefined || v.lastName !== undefined, {
    message: 'Nothing to change',
  });

const updateTenantSchema = z
  .object({
    name: z.string().min(2).max(120).trim(),
    billingEmail: z.string().email().toLowerCase().trim().nullable(),
  })
  .partial()
  .refine((v) => v.name !== undefined || v.billingEmail !== undefined, {
    message: 'Nothing to change',
  });

@ApiTags('tenant')
@Controller()
export class TenantController {
  constructor(
    @InjectModel(Tenant) private readonly tenants: typeof Tenant,
    @InjectModel(Membership) private readonly memberships: typeof Membership,
    @InjectModel(User) private readonly users: typeof User,
    @InjectConnection() private readonly sequelize: Sequelize,
    private readonly plans: PlanService,
    private readonly audit: AuditService,
  ) {}

  @Patch('me')
  @ApiOperation({ summary: 'Change your own name' })
  async updateMe(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(updateMeSchema))
    body: z.infer<typeof updateMeSchema>,
  ) {
    // Your own account, not the tenant's data: any role may change it, and
    // it isn't a tenant audit entry - the same person may belong to several.
    const me = await this.users.findByPk(user.id);
    if (!me) throw new NotFoundException('User not found');
    await me.update(body);
    return {
      id: me.id,
      email: me.email,
      firstName: me.firstName,
      lastName: me.lastName,
    };
  }

  @Patch('tenant')
  @Roles(TenantRole.ADMIN)
  @ApiOperation({ summary: "Change the organisation's name or billing email" })
  async updateTenant(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(updateTenantSchema))
    body: z.infer<typeof updateTenantSchema>,
    @Req() req: Request,
  ) {
    return this.sequelize.transaction(async (transaction) => {
      const tenant = await this.tenants.findByPk(user.tenantId, { transaction });
      if (!tenant) throw new NotFoundException('Organisation not found');
      const before = { name: tenant.name, billingEmail: tenant.billingEmail };
      // The slug stays: it is in URLs and exports people already have.
      await tenant.update(body, { transaction });
      await this.audit.record(
        {
          actorUserId: user.id,
          entity: 'tenant',
          entityId: tenant.id,
          action: AuditAction.UPDATE,
          before,
          after: { name: tenant.name, billingEmail: tenant.billingEmail },
          ip: req.ip,
          userAgent: req.headers['user-agent'],
        },
        transaction,
      );
      return tenant;
    });
  }

  @Get('me')
  @ApiOperation({ summary: 'The signed-in user, their tenants and current role' })
  async me(@CurrentUser() user: AuthenticatedUser) {
    const memberships = await this.memberships.findAll({
      where: { userId: user.id },
      include: [Tenant],
    });
    // Names aren't in the token; read them so a client can show and edit them.
    const profile = await this.users.findByPk(user.id, {
      attributes: ['firstName', 'lastName'],
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        platformRole: user.platformRole,
        firstName: profile?.firstName ?? null,
        lastName: profile?.lastName ?? null,
      },
      currentTenantId: user.tenantId,
      role: user.role,
      tenants: memberships.map((m) => ({
        id: m.tenantId,
        name: m.tenant?.name,
        slug: m.tenant?.slug,
        role: m.role,
        status: m.status,
      })),
    };
  }

  @Get('tenant')
  @ApiOperation({ summary: 'Current tenant settings' })
  async current(@CurrentUser() user: AuthenticatedUser) {
    const tenant = await this.tenants.findByPk(user.tenantId);
    return tenant;
  }

  @Get('tenant/custom-fields')
  @ApiOperation({ summary: 'The extra fields this organisation records' })
  async customFields(@CurrentUser() user: AuthenticatedUser) {
    const tenant = await this.tenants.findByPk(user.tenantId);
    return (tenant?.settings?.customFields as CustomField[]) ?? [];
  }

  @Put('tenant/custom-fields')
  @Roles(TenantRole.ADMIN)
  @ApiOperation({ summary: 'Define the extra fields — admin and owner only' })
  async setCustomFields(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(customFieldsSchema)) body: { fields: CustomField[] },
  ) {
    const limits = await this.plans.effectiveLimits(user.tenantId);

    if (
      !PlanService.isUnlimited(limits.customFields) &&
      body.fields.length > limits.customFields
    ) {
      throw new BadRequestException({
        statusCode: 402,
        error: 'Plan limit reached',
        message:
          limits.customFields === 0
            ? 'Custom fields are not included in your plan. Upgrade to use them.'
            : `Your plan allows ${limits.customFields} custom fields.`,
        metric: 'customFields',
        limit: limits.customFields,
        current: body.fields.length,
        upgradeUrl: '/billing',
      });
    }

    const keys = body.fields.map((f) => f.key);
    if (new Set(keys).size !== keys.length) {
      throw new BadRequestException('Two fields cannot share the same key');
    }

    const tenant = await this.tenants.findByPk(user.tenantId);
    if (!tenant) throw new BadRequestException('Organisation not found');

    // Merged into settings rather than replacing it, so defining a field does
    // not wipe the limit overrides sitting beside it.
    await tenant.update({
      settings: { ...(tenant.settings ?? {}), customFields: body.fields },
    });

    return body.fields;
  }

  @Get('tenant/members')
  @Roles(TenantRole.ADMIN)
  @ApiOperation({ summary: 'List members - admin and owner only' })
  async members(@CurrentUser() user: AuthenticatedUser) {
    return this.memberships.findAll({
      where: { tenantId: user.tenantId },
      include: [{ model: User, attributes: ['id', 'email', 'firstName', 'lastName'] }],
    });
  }
}
