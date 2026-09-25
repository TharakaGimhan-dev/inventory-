// public.decorator.ts marks the few routes that do not need a token.
//
// Authentication is global (APP_GUARD), so a new route is protected by default
// and opening it is an explicit, greppable act. The reverse default - open
// unless annotated - leaks a route every time someone forgets.
import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
