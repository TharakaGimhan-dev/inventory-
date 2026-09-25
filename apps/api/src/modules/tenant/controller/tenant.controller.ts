// tenant.controller.ts serves the current tenant and its members.
import { BadRequestException, Body, Controller, Get, Put } from '@nestjs/common';
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

@ApiTags('tenant')
@Controller()
export class TenantController {
  constructor(
    @InjectModel(Tenant) private readonly tenants: typeof Tenant,
    @InjectModel(Membership) private readonly memberships: typeof Membership,
    private readonly plans: PlanService,
  ) {}

  @Get('me')
  @ApiOperation({ summary: 'The signed-in user, their tenants and current role' })
  async me(@CurrentUser() user: AuthenticatedUser) {
    const memberships = await this.memberships.findAll({
      where: { userId: user.id },
      include: [Tenant],
    });

    return {
      user: { id: user.id, email: user.email, platformRole: user.platformRole },
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
