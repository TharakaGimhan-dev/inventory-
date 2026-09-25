// asset.ts holds the enums the register is built from. They are constants rather
// than free text so a filter, a report and a form can never disagree about what
// "in store" is called.

// An asset is tracked individually and carries a code on a label. A consumable
// is counted, not labelled - 40 reams of paper is one row with quantity 40.
export enum AssetKind {
  ASSET = 'asset',
  CONSUMABLE = 'consumable',
}

export enum AssetStatus {
  IN_USE = 'in_use',
  IN_STORE = 'in_store',
  REPAIR = 'repair',
  WRITTEN_OFF = 'written_off',
  DISPOSED = 'disposed',
}

export enum AssetCondition {
  NEW = 'new',
  GOOD = 'good',
  FAIR = 'fair',
  POOR = 'poor',
}

// The action recorded on an audit entry. Read as "who did what to which row".
export enum AuditAction {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  MOVE = 'move',
  EXPORT = 'export',
}
