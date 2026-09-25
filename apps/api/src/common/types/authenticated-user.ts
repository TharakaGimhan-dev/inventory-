// authenticated-user.ts is what the JWT strategy attaches to the request and
// what @CurrentUser() returns.
import { PlatformRole, TenantRole } from '../constants/roles';

export type AuthenticatedUser = {
  id: string;
  email: string;
  /** The tenant this access token is scoped to. */
  tenantId: string;
  /** Role inside THAT tenant - it changes when the user switches tenant. */
  role: TenantRole;
  platformRole: PlatformRole;
};

/** Claims carried in the access token. Short names keep the token small. */
export type AccessTokenPayload = {
  sub: string;
  email: string;
  tid: string;
  role: TenantRole;
  prole: PlatformRole;
};

export type RefreshTokenPayload = {
  sub: string;
  /** Session id, so one device can be revoked without logging out the others. */
  sid: string;
};
