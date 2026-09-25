// asset.controller.ts is the register's HTTP surface.
import {
  Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe,
  Patch, Post, Query, Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { TenantRole } from '../../../common/constants/roles';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { AuthenticatedUser } from '../../../common/types/authenticated-user';
import {
  CreateAssetInput, ListAssetsQuery, MoveAssetInput, UpdateAssetInput,
  createAssetSchema, listAssetsSchema, moveAssetSchema, updateAssetSchema,
} from '../schemas/asset.schema';
import { AssetService, RequestMeta } from '../service/asset.service';

@ApiTags('assets')
@Controller('assets')
export class AssetController {
  constructor(private readonly assets: AssetService) {}

  // No @Roles: viewer may read. Every write below names its minimum role.
  @Get()
  @ApiOperation({ summary: 'Search and page the register' })
  list(
    @Query(new ZodValidationPipe(listAssetsSchema)) query: ListAssetsQuery,
  ) {
    return this.assets.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One asset' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.assets.findOne(id);
  }

  @Get(':id/history')
  @ApiOperation({ summary: 'Where it has been and who held it' })
  history(@Param('id', ParseUUIDPipe) id: string) {
    return this.assets.history(id);
  }

  @Post()
  @Roles(TenantRole.ENTRY)
  @ApiOperation({ summary: 'Capture an asset - the code is issued by the server' })
  create(
    @Body(new ZodValidationPipe(createAssetSchema)) body: CreateAssetInput,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.assets.create(body, user, meta(req));
  }

  @Patch(':id')
  @Roles(TenantRole.ENTRY)
  @ApiOperation({ summary: 'Edit an asset - code cannot be changed' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateAssetSchema)) body: UpdateAssetInput,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.assets.update(id, body, user, meta(req));
  }

  @Post(':id/move')
  @Roles(TenantRole.ENTRY)
  @HttpCode(200)
  @ApiOperation({ summary: 'Record a location or custody change' })
  move(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(moveAssetSchema)) body: MoveAssetInput,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.assets.move(id, body, user, meta(req));
  }

  @Delete(':id')
  @Roles(TenantRole.ADMIN)
  @HttpCode(204)
  @ApiOperation({ summary: 'Soft-delete an asset - the code stays taken' })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.assets.remove(id, user, meta(req));
  }
}

// Recorded on every audit entry, so "who changed this" has an address next to it.
function meta(req: Request): RequestMeta {
  return {
    ip: req.ip ?? null,
    userAgent: req.get('user-agent') ?? null,
  };
}
