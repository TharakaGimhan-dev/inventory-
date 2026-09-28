// upload.module.ts signs photo uploads to ImageKit and meters their storage.
import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { UploadController } from './controller/upload.controller';
import { UploadService } from './service/upload.service';

@Module({
  // For UsageService and PlanService: every signature reserves storage
  // against the plan before it is issued.
  imports: [BillingModule],
  controllers: [UploadController],
  providers: [UploadService],
})
export class UploadModule {}
