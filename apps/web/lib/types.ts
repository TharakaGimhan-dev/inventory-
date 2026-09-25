// types.ts mirrors what the API returns. Hand-written rather than generated, so
// the web app compiles without the API present.
export type TenantRole = 'owner' | 'admin' | 'entry' | 'viewer';

export type AssetStatus =
  | 'in_use' | 'in_store' | 'repair' | 'written_off' | 'disposed';

export type AssetKind = 'asset' | 'consumable';

export type Me = {
  user: { id: string; email: string; platformRole: string };
  currentTenantId: string;
  role: TenantRole;
  tenants: { id: string; name: string; slug: string; role: TenantRole }[];
};

export type Asset = {
  id: string;
  code: string;
  kind: AssetKind;
  name: string;
  description: string | null;
  status: AssetStatus;
  condition: string;
  serialNumber: string | null;
  locationId: string | null;
  categoryId: string | null;
  purchasePrice: string | null;
  replacementValue: string | null;
  quantity: number;
  createdAt: string;
  /** Set by the outbox on a row that has not reached the server yet. */
  pending?: boolean;
};

export type Paged<T> = {
  items: T[];
  total: number;
  limit: number;
  offset: number;
};

export type Location = { id: string; name: string; isActive: boolean };
export type Category = { id: string; name: string };

export const STATUS_LABELS: Record<AssetStatus, string> = {
  in_use: 'In use',
  in_store: 'In store',
  repair: 'Repair',
  written_off: 'Written off',
  disposed: 'Disposed',
};
