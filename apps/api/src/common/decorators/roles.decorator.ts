// roles.decorator.ts declares the minimum role a route requires.
import { SetMetadata } from '@nestjs/common';
import { TenantRole } from '../constants/roles';

export const ROLES_KEY = 'roles';

/** @Roles(TenantRole.ADMIN) - admin and owner pass, entry and viewer do not. */
export const Roles = (...roles: TenantRole[]) => SetMetadata(ROLES_KEY, roles);
