// security.module.ts groups the cross-cutting security services.
//
// Its own module because ThrottlerModule.forRootAsync resolves inside its own
// injection context: a provider listed in AppModule is not visible to it, so
// the storage has to be exported from somewhere the throttler can import.
//
// Global, because the login lockout and the throttler storage are wanted
// wherever authentication happens rather than in one feature.
import { Global, Module } from '@nestjs/common';
import { LoginAttemptsService } from './login-attempts.service';
import { RedisThrottlerStorage } from './redis-throttler.storage';

@Global()
@Module({
  providers: [RedisThrottlerStorage, LoginAttemptsService],
  exports: [RedisThrottlerStorage, LoginAttemptsService],
})
export class SecurityModule {}
