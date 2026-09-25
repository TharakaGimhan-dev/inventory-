// tenant-scoped.model.ts marks the models that belong to one tenant.
//
// Extending this class is what makes the query hook filter a model. It is a
// marker, not a source of columns: each model declares its own tenantId column
// so the Sequelize decorators are unambiguous and the foreign key is explicit.
import { Model } from 'sequelize-typescript';

export abstract class TenantScopedModel<
  TAttributes extends object = any,
  TCreation extends object = TAttributes,
> extends Model<TAttributes, TCreation> {
  declare tenantId: string;
}

/** True when this Sequelize model is tenant-owned. Used by the hook. */
export function isTenantScoped(model: unknown): boolean {
  if (typeof model !== 'function') return false;

  // Walks the prototype chain rather than comparing names, so a model that
  // extends another tenant-scoped model is still caught.
  let proto: unknown = model;
  while (proto) {
    if (proto === TenantScopedModel) return true;
    proto = Object.getPrototypeOf(proto);
  }
  return false;
}
