// asset.schema.ts is the contract for the register, shared with the web form.
import { z } from 'zod';
import {
  AssetCondition, AssetKind, AssetStatus,
} from '../../../common/constants/asset';

// Money arrives as a string and stays one all the way to DECIMAL. Parsing it
// into a JS number would round 1234567.89 on the way through.
const money = z
  .string()
  .regex(/^\d{1,10}(\.\d{1,2})?$/, 'Expected an amount like 12500.00')
  .optional()
  .nullable();

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a date as YYYY-MM-DD')
  .optional()
  .nullable();

const base = {
  name: z.string().min(1).max(160).trim(),
  description: z.string().max(4000).trim().optional().nullable(),
  categoryId: z.string().uuid().optional().nullable(),
  locationId: z.string().uuid().optional().nullable(),
  assignedToUserId: z.string().uuid().optional().nullable(),
  serialNumber: z.string().max(120).trim().optional().nullable(),
  status: z.nativeEnum(AssetStatus).optional(),
  condition: z.nativeEnum(AssetCondition).optional(),
  purchaseDate: isoDate,
  purchasePrice: money,
  replacementValue: money,
  supplier: z.string().max(160).trim().optional().nullable(),
  warrantyEndsAt: isoDate,
  imageIds: z.array(z.string().max(200)).max(10).optional(),
  customFields: z.record(z.string(), z.unknown()).optional(),
};

export const createAssetSchema = z
  .object({
    kind: z.nativeEnum(AssetKind).default(AssetKind.ASSET),
    quantity: z.number().int().min(1).max(1_000_000).optional(),
    ...base,
  })
  // `code` is deliberately absent: it is issued by the server. Zod strips
  // unknown keys, so a client that sends one is ignored rather than obeyed.
  .refine(
    (v) => v.kind === AssetKind.CONSUMABLE || (v.quantity ?? 1) === 1,
    {
      message:
        'An individually tracked asset is always quantity 1. Use kind=consumable to count stock.',
      path: ['quantity'],
    },
  );

// Update takes the same fields minus kind: an asset does not become a
// consumable, because its code is already on a label and its history assumes
// one physical thing.
export const updateAssetSchema = z
  .object({ quantity: z.number().int().min(1).max(1_000_000).optional(), ...base })
  .partial();

export const moveAssetSchema = z.object({
  toLocationId: z.string().uuid().optional().nullable(),
  toUserId: z.string().uuid().optional().nullable(),
  note: z.string().max(1000).trim().optional().nullable(),
}).refine((v) => v.toLocationId !== undefined || v.toUserId !== undefined, {
  message: 'A movement must change the location, the holder, or both',
});

export const listAssetsSchema = z.object({
  q: z.string().max(120).trim().optional(),
  status: z.nativeEnum(AssetStatus).optional(),
  kind: z.nativeEnum(AssetKind).optional(),
  categoryId: z.string().uuid().optional(),
  locationId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
});

export type CreateAssetInput = z.infer<typeof createAssetSchema>;
export type UpdateAssetInput = z.infer<typeof updateAssetSchema>;
export type MoveAssetInput = z.infer<typeof moveAssetSchema>;
export type ListAssetsQuery = z.infer<typeof listAssetsSchema>;
