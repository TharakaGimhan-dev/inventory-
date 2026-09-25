import { Global, Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { ApiKeyController } from './controller/api-key.controller';
import { ApiKey } from './models/api-key.model';
import { ApiKeyService } from './service/api-key.service';

// Global: the auth guard resolves API keys on every request.
@Global()
@Module({
  imports: [SequelizeModule.forFeature([ApiKey])],
  controllers: [ApiKeyController],
  providers: [ApiKeyService],
  exports: [ApiKeyService, SequelizeModule],
})
export class ApiKeyModule {}
