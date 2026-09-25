import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { User } from '../user/models/user.model';
import { TenantController } from './controller/tenant.controller';
import { Membership } from './models/membership.model';
import { Tenant } from './models/tenant.model';

@Module({
  imports: [SequelizeModule.forFeature([Tenant, Membership, User])],
  controllers: [TenantController],
  exports: [SequelizeModule],
})
export class TenantModule {}
