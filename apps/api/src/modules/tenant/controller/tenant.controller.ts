// tenant.controller.ts serves the current tenant and its members.
import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { InjectModel } from '@nestjs/sequelize';
import { Roles } from '../../../common/decorators/roles.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { TenantRole } from '../../../common/constants/roles';
import { AuthenticatedUser } from '../../../common/types/authenticated-user';
import { Membership } from '../models/membership.model';
import { Tenant } from '../models/tenant.model';
import { User } from '../../user/models/user.model';

@ApiTags('tenant')
@Controller()
export class TenantController {
  constructor(
    @InjectModel(Tenant) private readonly tenants: typeof Tenant,
    @InjectModel(Membership) private readonly memberships: typeof Membership,
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
