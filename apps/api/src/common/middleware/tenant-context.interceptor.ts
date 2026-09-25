// tenant-context.interceptor.ts binds the authenticated tenant to the request.
//
// An interceptor, not middleware: middleware runs BEFORE guards, so request.user
// does not exist yet there. The tenant must come from the verified token, never
// from a header, a query parameter or the body - all three are attacker-controlled.
import {
  CallHandler, ExecutionContext, Injectable, NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { enterTenant } from '../context/tenant.context';
import { AuthenticatedUser } from '../types/authenticated-user';

@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const user = context
      .switchToHttp()
      .getRequest<{ user?: AuthenticatedUser }>().user;

    // Public routes have no user. They are left with no tenant on purpose: if
    // such a route ever touches tenant data, the hook throws rather than
    // quietly serving whatever happens to be in the table.
    if (!user?.tenantId) return next.handle();

    // enterWith, not run(): the handler executes when the framework subscribes
    // to this observable, long after a run() callback would have returned. See
    // enterTenant() for the full reason.
    enterTenant({ tenantId: user.tenantId, userId: user.id });

    return next.handle();
  }
}
