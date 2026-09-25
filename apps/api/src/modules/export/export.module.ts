import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { AssetModule } from '../asset/asset.module';
import { Asset } from '../asset/models/asset.model';
import { Category } from '../asset/models/category.model';
import { Location } from '../asset/models/location.model';
import { Tenant } from '../tenant/models/tenant.model';
import { ExportController } from './controller/export.controller';
import { ExportService } from './service/export.service';
import { ImportService } from './service/import.service';
import { PdfService } from './service/pdf.service';

@Module({
  imports: [
    SequelizeModule.forFeature([Asset, Location, Category, Tenant]),
    // For AssetCodeService: an import issues codes the same way a capture does.
    AssetModule,
  ],
  controllers: [ExportController],
  providers: [ExportService, PdfService, ImportService],
  exports: [ExportService],
})
export class ExportModule {}
