import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { AssetController } from './controller/asset.controller';
import { CategoryController, LocationController } from './controller/taxonomy.controller';
import { Asset } from './models/asset.model';
import { AssetMovement } from './models/asset-movement.model';
import { Category } from './models/category.model';
import { Counter } from './models/counter.model';
import { Location } from './models/location.model';
import { AssetCodeService } from './service/asset-code.service';
import { AssetService } from './service/asset.service';

@Module({
  imports: [
    SequelizeModule.forFeature([Asset, AssetMovement, Location, Category, Counter]),
  ],
  controllers: [AssetController, LocationController, CategoryController],
  providers: [AssetService, AssetCodeService],
  // AssetCodeService is exported for the import path: a bulk import issues
  // codes the same way a single capture does, so both stay gapless.
  exports: [AssetService, AssetCodeService, SequelizeModule],
})
export class AssetModule {}
