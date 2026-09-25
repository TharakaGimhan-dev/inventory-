// taxonomy.schema.ts covers locations and categories - the two lists an asset
// is filed under.
import { z } from 'zod';

export const createLocationSchema = z.object({
  name: z.string().min(1).max(120).trim(),
  parentId: z.string().uuid().optional().nullable(),
  code: z.string().max(32).trim().optional().nullable(),
});

export const updateLocationSchema = createLocationSchema
  .extend({ isActive: z.boolean() })
  .partial();

export const createCategorySchema = z.object({
  name: z.string().min(1).max(120).trim(),
  parentId: z.string().uuid().optional().nullable(),
  defaultUsefulLifeMonths: z.number().int().min(1).max(1200).optional().nullable(),
});

export const updateCategorySchema = createCategorySchema.partial();

export type CreateLocationInput = z.infer<typeof createLocationSchema>;
export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
