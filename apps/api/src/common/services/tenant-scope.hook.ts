// tenant-scope.hook.ts is the third isolation layer, and the one that actually
// holds the line.
//
// Layers 1 and 2 (the schema and the request context) can both be satisfied by a
// developer who then forgets `where: { tenantId }` on a query. This file makes
// that forgetting impossible: Sequelize hooks inject the tenant into every read
// and every write on a tenant-scoped model, and throw when the tenant is unknown.
//
// Failing closed is the whole point. A bug here must return nothing or raise,
// never "all rows".
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import {
  getCurrentTenantId,
  isTenantScopeBypassed,
} from '../context/tenant.context';
import { isTenantScoped } from '../models/tenant-scoped.model';

/**
 * Thrown when a tenant-scoped model is queried with no tenant in context.
 *
 * This is a server fault, not a client one - it means a route or a job touched
 * tenant data without establishing who it belongs to.
 */
/**
 * Thrown when a query or a write explicitly names a tenant other than the one
 * in context.
 *
 * Silently rewriting it would be worse than failing: the query would then mean
 * something different from what it says, and a genuine cross-tenant bug would
 * return plausible-looking data instead of an error anyone notices.
 */
export class CrossTenantAccessError extends Error {
  constructor(modelName: string, requested: string, actual: string) {
    super(
      `Refusing a ${modelName} operation naming tenant ${requested} while the ` +
        `request context is tenant ${actual}.`,
    );
    this.name = 'CrossTenantAccessError';
  }
}

export class MissingTenantContextError extends Error {
  constructor(modelName: string) {
    super(
      `Query on tenant-scoped model "${modelName}" was attempted with no tenant ` +
        `in context. Wrap the call in runWithTenant(), or runWithoutTenantScope() ` +
        `if this is an audited platform-admin operation.`,
    );
    this.name = 'MissingTenantContextError';
  }
}

@Injectable()
export class TenantScopeHook implements OnModuleInit {
  private readonly logger = new Logger(TenantScopeHook.name);

  constructor(@InjectConnection() private readonly sequelize: Sequelize) {}

  onModuleInit() {
    this.register(this.sequelize);
  }

  /**
   * Registers the hooks on every tenant-scoped model of a connection.
   *
   * Per model, not on the connection: Sequelize's connection-level `beforeFind`
   * is handed an options object with no `model` on it, so a global hook cannot
   * tell which table is being queried and would have to scope all of them or
   * none. Binding per model closes over the right one.
   */
  register(sequelize: Sequelize): void {
    const scoped = Object.values(sequelize.models).filter((m) =>
      isTenantScoped(m),
    );

    for (const model of scoped) {
      const name = model.name;

      // findAll, findOne, findByPk and every association load go through this.
      // count() does not, and neither do the bulk update/destroy forms that
      // never instantiate a row - missing any one of them is how a "how many
      // assets?" endpoint ends up counting every customer's.
      for (const hook of [
        'beforeFind',
        'beforeCount',
        'beforeBulkUpdate',
        'beforeBulkDestroy',
      ] as const) {
        model.addHook(hook, `tenantScope:${name}:${hook}`, (options: any) => {
          if (!this.active()) return;
          options.where = this.scopeWhere(options.where, name);
        });
      }

      // On write, the tenant comes from the context and overwrites whatever the
      // client sent. This is why a request body carrying another tenant's id
      // cannot plant a row there - spec section 3.2 case 2.
      model.addHook('beforeValidate', `tenantScope:${name}:write`, (instance: any) => {
        if (!this.active()) return;
        const tenantId = this.require(name);

        if (instance.tenantId && instance.tenantId !== tenantId) {
          throw new CrossTenantAccessError(name, instance.tenantId, tenantId);
        }

        instance.tenantId = tenantId;
      });
    }

    this.logger.log(
      `Tenant scope active on ${scoped.length} model(s): ` +
        `${scoped.map((m) => m.name).join(', ') || 'none yet'}`,
    );
  }

  /**
   * Forces the tenant onto a where clause.
   *
   * A caller that named a different tenant is rejected rather than quietly
   * rewritten, so an isolation bug surfaces as an error in the logs instead of
   * as a query that returns the wrong customer's rows without complaint.
   */
  private scopeWhere(where: any, modelName: string): any {
    const tenantId = this.require(modelName);
    const requested = where?.tenantId;

    if (typeof requested === 'string' && requested !== tenantId) {
      throw new CrossTenantAccessError(modelName, requested, tenantId);
    }

    return { ...(where ?? {}), tenantId };
  }

  /** False only inside an audited runWithoutTenantScope() block. */
  private active(): boolean {
    return !isTenantScopeBypassed();
  }

  private require(modelName: string): string {
    const tenantId = getCurrentTenantId();
    if (!tenantId) throw new MissingTenantContextError(modelName);
    return tenantId;
  }
}
