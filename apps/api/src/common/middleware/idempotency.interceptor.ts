// idempotency.interceptor.ts makes a repeated POST safe to send twice.
//
// The offline outbox in the web app cannot know whether a request that timed
// out was applied. Without this, a phone that loses signal mid-capture and
// retries creates the asset twice - and each copy consumes an asset code, so
// the duplicate is permanent and visible on a label.
//
// A client sends Idempotency-Key with a value it generated. The first request
// under that key runs and its response is stored; a repeat returns the stored
// response without touching the database.
import {
  CallHandler, ConflictException, ExecutionContext, Inject, Injectable,
  NestInterceptor,
} from '@nestjs/common';
import Redis from 'ioredis';
import { Observable, from, of, switchMap, tap } from 'rxjs';
import { REDIS_CLIENT } from '../../configs/redis/redis.module';
import { AuthenticatedUser } from '../types/authenticated-user';

const TTL_SECONDS = 24 * 60 * 60;

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<{
      method: string;
      headers: Record<string, string | undefined>;
      user?: AuthenticatedUser;
    }>();

    const key = request.headers['idempotency-key'];

    // Optional: a browser form posting once needs no key, and requiring one
    // would break every client that does not know about offline capture.
    if (!key || request.method !== 'POST' || !request.user) {
      return next.handle();
    }

    // Scoped to the tenant, so one customer's key can never collide with
    // another's and hand them someone else's stored response.
    const cacheKey = `idem:${request.user.tenantId}:${key}`;

    return from(this.redis.get(cacheKey)).pipe(
      switchMap((stored) => {
        if (stored === IN_FLIGHT) {
          // The first copy is still running. Returning the half-finished state
          // would be a lie, so the client is told to retry.
          throw new ConflictException(
            'A request with this Idempotency-Key is still in progress',
          );
        }

        if (stored) return of(JSON.parse(stored));

        // SET NX: only one concurrent request can claim the key, so two copies
        // arriving together cannot both proceed to the handler.
        return from(
          this.redis.set(cacheKey, IN_FLIGHT, 'EX', TTL_SECONDS, 'NX'),
        ).pipe(
          switchMap((claimed) => {
            if (!claimed) {
              throw new ConflictException(
                'A request with this Idempotency-Key is still in progress',
              );
            }

            return next.handle().pipe(
              tap({
                next: (body) => {
                  void this.redis.set(
                    cacheKey,
                    JSON.stringify(body),
                    'EX',
                    TTL_SECONDS,
                  );
                },
                error: () => {
                  // The claim is released on failure, so a genuine retry after
                  // an error is allowed to run rather than being locked out
                  // for a day.
                  void this.redis.del(cacheKey);
                },
              }),
            );
          }),
        );
      }),
    );
  }
}

const IN_FLIGHT = '__in_flight__';
