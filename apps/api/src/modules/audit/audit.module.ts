import { Global, Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { AuditController } from './controller/audit.controller';
import { AuditEntry } from './models/audit-entry.model';
import { AuditService } from './service/audit.service';

// Global: every module that writes tenant data has to record an entry, and
// importing this into each of them adds nothing but noise.
@Global()
@Module({
  imports: [SequelizeModule.forFeature([AuditEntry])],
  controllers: [AuditController],
  providers: [AuditService],
  exports: [AuditService, SequelizeModule],
})
export class AuditModule {}
