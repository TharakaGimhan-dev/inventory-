// audit.controller.ts exposes the trail read-only.
//
// There is no POST, PATCH or DELETE here, at any role. Entries are written by
// the services that make the change, inside the same transaction, and the model
// itself refuses updates and deletes.
import { Controller, Get, Query } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { TenantRole } from '../../../common/constants/roles';
import { Roles } from '../../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { AuditEntry } from '../models/audit-entry.model';

const listSchema = z.object({
  entity: z.string().max(40).optional(),
  entityId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

@ApiTags('audit')
@Controller('audit')
export class AuditController {
  constructor(
    @InjectModel(AuditEntry) private readonly entries: typeof AuditEntry,
  ) {}

  @Get()
  @Roles(TenantRole.ADMIN)
  @ApiOperation({ summary: 'Read the audit trail - append-only, never editable' })
  async list(
    @Query(new ZodValidationPipe(listSchema)) query: z.infer<typeof listSchema>,
  ) {
    const where: Record<string, unknown> = {};
    if (query.entity) where.entity = query.entity;
    if (query.entityId) where.entityId = query.entityId;

    const { rows, count } = await this.entries.findAndCountAll({
      where,
      limit: query.limit,
      offset: query.offset,
      order: [['createdAt', 'DESC']],
    });

    return { items: rows, total: count };
  }
}
