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
  exports: [AssetService, SequelizeModule],
})
export class AssetModule {}
