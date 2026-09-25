// export.controller.ts serves the files.
//
// The export routes live under /assets so they read as part of the register,
// and so the always-allowed rule in SubscriptionAccessGuard - which matches on
// /assets/export - keeps its promise.
import {
  Body, Controller, Get, Header, HttpCode, Post, Res, StreamableFile,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { z } from 'zod';
import { TenantRole } from '../../../common/constants/roles';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequiresFeature } from '../../../common/decorators/feature.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { AuthenticatedUser } from '../../../common/types/authenticated-user';
import { Tenant } from '../../tenant/models/tenant.model';
import { ExportService } from '../service/export.service';
import { ImportService } from '../service/import.service';
import { PdfService } from '../service/pdf.service';

const importSchema = z.object({
  // The file is posted as text rather than multipart: a register CSV is small,
  // and it keeps the endpoint free of upload plumbing.
  csv: z.string().min(1).max(5 * 1024 * 1024),
  // A dry run returns the problems without writing anything, which is what the
  // web app calls first so the customer sees their mistakes before committing.
  dryRun: z.boolean().default(false),
});

const labelsSchema = z.object({
  ids: z.array(z.string().uuid()).max(480).optional(),
});

@ApiTags('export')
@Controller('assets')
export class ExportController {
  constructor(
    private readonly exports: ExportService,
    private readonly pdf: PdfService,
    private readonly imports: ImportService,
    @InjectModel(Tenant) private readonly tenants: typeof Tenant,
  ) {}

  @Get('export')
  @ApiOperation({ summary: 'The whole register as CSV — every plan, always' })
  async csv(@Res({ passthrough: true }) res: Response) {
    // No @RequiresFeature and no role above viewer: this is the promise that a
    // customer can always take their data, and the subscription guard exempts
    // this path too.
    const { body, filename } = await this.exports.csv();

    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    });

    return body;
  }

  @Get('export.xlsx')
  @RequiresFeature('reports')
  @ApiOperation({ summary: 'The register as an Excel workbook' })
  async xlsx(@Res({ passthrough: true }) res: Response) {
    const { body, filename } = await this.exports.xlsx();

    res.set({
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
    });

    return new StreamableFile(body);
  }

  @Get('report.pdf')
  @RequiresFeature('reports')
  @ApiOperation({ summary: 'A one-page summary report' })
  async report(
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const tenant = await this.tenants.findByPk(user.tenantId);
    const body = await this.pdf.report(tenant?.name ?? 'Asset register');

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="asset-report-${today()}.pdf"`,
    });

    return new StreamableFile(body);
  }

  @Post('labels.pdf')
  @RequiresFeature('labels')
  // POST because the caller sends which assets to print, but it creates
  // nothing, so 200 rather than 201.
  @HttpCode(200)
  @Header('Content-Type', 'application/pdf')
  @ApiOperation({ summary: 'A printable sheet of QR labels' })
  async labels(
    @Body(new ZodValidationPipe(labelsSchema)) body: { ids?: string[] },
    @Res({ passthrough: true }) res: Response,
  ) {
    const pdf = await this.pdf.labels(body.ids);

    res.set({
      'Content-Disposition': `attachment; filename="asset-labels-${today()}.pdf"`,
    });

    return new StreamableFile(pdf);
  }

  @Post('import')
  @Roles(TenantRole.ADMIN)
  @ApiOperation({ summary: 'Bring an existing register in from a CSV' })
  async import(
    @Body(new ZodValidationPipe(importSchema))
    body: { csv: string; dryRun: boolean },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const { rows, problems } = this.imports.parse(body.csv);

    // Nothing is written while the file has a problem in it. Half an import,
    // with no way to tell which half, is worse than none.
    if (problems.length > 0) {
      return { imported: 0, willImport: rows.length, problems, applied: false };
    }

    if (body.dryRun) {
      return { imported: 0, willImport: rows.length, problems: [], applied: false };
    }

    const result = await this.imports.apply(rows, user);
    return { ...result, applied: true };
  }
}

const today = () => new Date().toISOString().slice(0, 10);
