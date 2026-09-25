// auth.schema.ts holds the Zod schemas for the auth routes. These are the
// schemas the web app imports too, so the form and the write path cannot drift.
import { z } from 'zod';

// Rejected at the edge rather than trimmed silently, so a user who pastes a
// password with a trailing space learns why it fails.
const password = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(200);

export const registerSchema = z.object({
  email: z.string().email().toLowerCase().trim(),
  password,
  firstName: z.string().min(1).max(80).trim(),
  lastName: z.string().min(1).max(80).trim(),
  // The company name. The tenant and the owner membership are created with the
  // user in one transaction - see AuthService.register.
  organisationName: z.string().min(2).max(120).trim(),
});

export const loginSchema = z.object({
  email: z.string().email().toLowerCase().trim(),
  password: z.string().min(1),
});

export const switchTenantSchema = z.object({
  tenantId: z.string().uuid(),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1).optional(),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type SwitchTenantInput = z.infer<typeof switchTenantSchema>;
