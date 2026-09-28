// upload.controller.ts hands out ImageKit upload signatures.
import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { TenantRole } from '../../../common/constants/roles';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Quota } from '../../../common/decorators/quota.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { AuthenticatedUser } from '../../../common/types/authenticated-user';
import { UsageMetric } from '../../billing/models/usage-counter.model';
import { SignUploadInput, signUploadSchema } from '../schemas/upload.schema';
import { UploadService } from '../service/upload.service';

@ApiTags('uploads')
@Controller('uploads')
export class UploadController {
  constructor(private readonly uploads: UploadService) {}

  // No @Roles: a viewer still needs the endpoint to display photos.
  @Get('config')
  @ApiOperation({ summary: 'Whether photo uploads are on, and where images are served from' })
  config() {
    return this.uploads.publicConfig();
  }

  @Post('sign')
  // Whoever may capture an asset may photograph it.
  @Roles(TenantRole.ENTRY)
  // The friendly early refusal for a tenant already at its storage limit. The
  // authoritative check is the reservation inside UploadService.sign.
  @Quota(UsageMetric.STORAGE_BYTES)
  // Creates nothing on our side a client could fetch back, so 200 not 201.
  @HttpCode(200)
  @ApiOperation({ summary: 'Reserve storage and sign one ImageKit upload' })
  sign(
    @Body(new ZodValidationPipe(signUploadSchema)) body: SignUploadInput,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.uploads.sign(user.tenantId, body);
  }
}
