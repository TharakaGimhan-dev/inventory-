// tenant.context.ts carries the current tenant through the request without
// passing it down every function signature.
//
// This is the second of the three isolation layers in spec section 3.1:
//   1. schema      - tenantId NOT NULL, composite unique keys
//   2. context     - this file
//   3. query layer - tenant-scope.hook.ts reads this file
//
// AsyncLocalStorage keeps one store per request even though Node runs every
// request on the same thread, so two concurrent requests from two tenants can
// never read each other's value.
import { AsyncLocalStorage } from 'node:async_hooks';

export type TenantStore = {
  tenantId: string;
  userId: string;
  /**
   * Set only by the platform-admin path. Every use is audited, because it turns
   * off the query-layer guarantee for the duration of the callback.
   */
  bypassTenantScope?: boolean;
};

const storage = new AsyncLocalStorage<TenantStore>();

/** Runs `fn` with the tenant bound to it and to everything it awaits. */
export function runWithTenant<T>(store: TenantStore, fn: () => T): T {
  return storage.run(store, fn);
}

/**
 * Turns off automatic tenant filtering for one callback.
 *
 * Only the platform-admin module may call this, and only for reads that are
 * genuinely cross-tenant (counting customers, reconciling usage). It is a named
 * function rather than an option on a query so that finding every place
 * isolation is bypassed is one grep.
 */
export function runWithoutTenantScope<T>(fn: () => T): T {
  const current = storage.getStore();
  return storage.run(
    { ...(current ?? { tenantId: '', userId: '' }), bypassTenantScope: true },
    fn,
  );
}

/** The current store, or undefined outside a request (jobs, boot, CLI). */
export function getTenantStore(): TenantStore | undefined {
  return storage.getStore();
}

/**
 * The current tenant id, or undefined.
 *
 * Deliberately NOT throwing here: the hook decides what a missing tenant means,
 * because that differs between a tenant-scoped model and an unscoped one.
 */
export function getCurrentTenantId(): string | undefined {
  const store = storage.getStore();
  return store?.bypassTenantScope ? undefined : store?.tenantId || undefined;
}

export function isTenantScopeBypassed(): boolean {
  return storage.getStore()?.bypassTenantScope === true;
}
