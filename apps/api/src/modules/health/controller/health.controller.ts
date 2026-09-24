// health.controller.ts exposes the endpoint Railway calls to decide whether a
// deploy succeeded. If it does not return 200 the new version is not promoted,
// so a build that cannot reach Postgres never replaces the running one.
import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  HealthCheck,
  HealthCheckService,
  SequelizeHealthIndicator,
} from '@nestjs/terminus';
import { RedisHealthIndicator } from '../service/redis.health';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly database: SequelizeHealthIndicator,
    private readonly redis: RedisHealthIndicator,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Deployment smoke check' })
  @HealthCheck()
  check() {
    // Terminus returns 503 if any indicator fails, which is what makes this
    // usable as a health check rather than a route that always answers 200.
    return this.health.check([
      () => this.database.pingCheck('database', { timeout: 3000 }),
      () => this.redis.isHealthy('redis'),
    ]);
  }

  @Get('live')
  @ApiOperation({ summary: 'Liveness only - does not touch dependencies' })
  live() {
    // Separate from /health on purpose. A restart should be triggered by the
    // process being wedged, not by Postgres having a bad minute.
    return { status: 'ok', uptime: process.uptime() };
  }
}
