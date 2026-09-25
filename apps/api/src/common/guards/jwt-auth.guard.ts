// jwt-auth.guard.ts is registered globally, so every route requires a valid
// access token unless it carries @Public().
import { ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
import { PlatformRole } from '../constants/roles';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ApiKeyService } from '../../modules/apikey/service/api-key.service';
import { AuthenticatedUser } from '../types/authenticated-user';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(
    private readonly reflector: Reflector,
    private readonly apiKeys: ApiKeyService,
  ) {
    super();
  }

  async canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) return true;

    // An X-API-Key is a machine calling on a customer's behalf. Checked before
    // the JWT strategy, because such a request carries no cookie and no bearer
    // token and would otherwise be rejected before it was ever looked at.
    const request = context.switchToHttp().getRequest<Request>();
    const presented = request.header('x-api-key');

    if (presented) {
      const key = await this.apiKeys.verify(presented);

      // Deliberately vague: a revoked key, an expired one and a made-up one
      // all sound the same, so the response cannot be used to probe.
      if (!key) throw new UnauthorizedException('Invalid API key');

      (request as unknown as { user: AuthenticatedUser }).user = {
        // The key's own id stands in for a user id, so the audit trail records
        // which credential acted rather than attributing it to whoever created it.
        id: key.id,
        email: `apikey:${key.prefix}`,
        tenantId: key.tenantId,
        role: key.role,
        platformRole: PlatformRole.NONE,
      };

      return true;
    }

    return (await super.canActivate(context)) as boolean;
  }
}
