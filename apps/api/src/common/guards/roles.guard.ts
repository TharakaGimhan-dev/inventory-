// roles.guard.ts enforces @Roles(). It runs after JwtAuthGuard, so request.user
// is already populated by the JWT strategy.
import {
  CanActivate, ExecutionContext, ForbiddenException, Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLE_RANK, TenantRole } from '../constants/roles';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { AuthenticatedUser } from '../types/authenticated-user';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<TenantRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required?.length) return true;

    const user = context
      .switchToHttp()
      .getRequest<{ user?: AuthenticatedUser }>().user;

    if (!user) throw new ForbiddenException('No authenticated user');

    // Rank comparison, so @Roles(ADMIN) admits owner too. Listing every role at
    // every route is how an owner ends up locked out of their own settings page.
    const floor = Math.min(...required.map((r) => ROLE_RANK[r]));
    if (ROLE_RANK[user.role] < floor) {
      throw new ForbiddenException(
        `Requires ${required.join(' or ')}; you are ${user.role}`,
      );
    }

    return true;
  }
}
