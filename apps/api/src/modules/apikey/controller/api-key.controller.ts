// api-key.controller.ts manages a customer's own API credentials.
import {
  Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { TenantRole } from '../../../common/constants/roles';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequiresFeature } from '../../../common/decorators/feature.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { AuthenticatedUser } from '../../../common/types/authenticated-user';
import { ApiKeyService } from '../service/api-key.service';

const createSchema = z.object({
  name: z.string().min(1).max(80).trim(),
  // Never owner or admin. An unattended credential should not be able to
  // delete the register or change what the company is billed.
  role: z.enum([TenantRole.VIEWER, TenantRole.ENTRY]).default(TenantRole.VIEWER),
});

@ApiTags('api-keys')
@Controller('api-keys')
// Admin and owner only, and only on a plan that includes API access.
@Roles(TenantRole.ADMIN)
@RequiresFeature('api')
export class ApiKeyController {
  constructor(private readonly keys: ApiKeyService) {}

  @Get()
  @ApiOperation({ summary: 'List keys — the secrets are never returned' })
  list() {
    return this.keys.list();
  }

  @Post()
  @ApiOperation({ summary: 'Create a key. The secret is shown once.' })
  create(
    @Body(new ZodValidationPipe(createSchema))
    body: { name: string; role: TenantRole },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.keys.create(body.name, body.role, user.id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Revoke a key' })
  revoke(@Param('id', ParseUUIDPipe) id: string) {
    return this.keys.revoke(id);
  }
}
