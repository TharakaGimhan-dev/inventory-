// roles.ts holds the two role axes. Keeping them as enums means a typo like
// 'Admin' vs 'ADMIN' is a compile error rather than a silent authorization hole.

// TenantRole is the role a user holds INSIDE one tenant. It lives on the
// membership row, not on the user, because one person can be an owner of their
// own company and a viewer in a client's tenant at the same time.
export enum TenantRole {
  OWNER = 'owner',
  ADMIN = 'admin',
  ENTRY = 'entry',
  VIEWER = 'viewer',
}

// Ranked so a guard can ask "at least admin" instead of listing every role.
export const ROLE_RANK: Record<TenantRole, number> = {
  [TenantRole.VIEWER]: 0,
  [TenantRole.ENTRY]: 1,
  [TenantRole.ADMIN]: 2,
  [TenantRole.OWNER]: 3,
};

// PlatformRole is our own staff, a separate axis from TenantRole. A tenant owner
// has no platform role; a support engineer has no membership in the tenant they
// are helping.
export enum PlatformRole {
  NONE = 'none',
  SUPPORT = 'support',
  SUPERADMIN = 'superadmin',
}

export enum TenantStatus {
  TRIALING = 'trialing',
  ACTIVE = 'active',
  PAST_DUE = 'past_due',
  SUSPENDED = 'suspended',
  CANCELLED = 'cancelled',
}

export enum MembershipStatus {
  INVITED = 'invited',
  ACTIVE = 'active',
  DISABLED = 'disabled',
}
