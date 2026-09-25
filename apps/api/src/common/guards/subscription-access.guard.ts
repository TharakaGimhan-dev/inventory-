// subscription-access.guard.ts narrows a tenant to read-only when they have
// stopped paying.
//
// Two rules hold this to the spec, section 6.4:
//   reads are never blocked - the data is theirs
//   export is never blocked - at any subscription state, they can take it away
//
// The second one costs us a lever and is worth it: a customer who cannot get
// their data out tells everyone, and a customer who leaves cleanly sometimes
// comes back.
import {
  CanActivate, ExecutionContext, ForbiddenException, Injectable,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthenticatedUser } from '../types/authenticated-user';
import { AccessService } from '../../modules/billing/service/access.service';

/** Always allowed, whatever the subscription says. */
const ALWAYS_ALLOWED = [
  /^\/api\/v1\/auth\//,
  /^\/api\/v1\/me$/,
  /^\/api\/v1\/billing\//,
  /^\/api\/v1\/health/,
  // The promise that export always works. Phase 6 adds the route; the rule is
  // written now so it cannot be forgotten when it arrives.
  /^\/api\/v1\/assets\/export/,
];

@Injectable()
export class SubscriptionAccessGuard implements CanActivate {
  constructor(private readonly access: AccessService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const user = (request as unknown as { user?: AuthenticatedUser }).user;

    if (!user) return true;

    // Reads are never blocked. Someone who has stopped paying can still look
    // up where a laptop is.
    if (request.method === 'GET' || request.method === 'HEAD') return true;

    const path = request.path ?? request.url;
    if (ALWAYS_ALLOWED.some((pattern) => pattern.test(path))) return true;

    const decision = await this.access.decide(user.tenantId);
    if (decision.level === 'full') return true;

    throw new ForbiddenException({
      statusCode: 403,
      error: 'Subscription inactive',
      message:
        decision.reason ??
        'Your subscription is not active. You can still read and export your data.',
      readOnly: true,
      upgradeUrl: '/billing',
    });
  }
}
