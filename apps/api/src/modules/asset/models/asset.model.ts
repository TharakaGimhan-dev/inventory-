// asset.model.ts is the core record of the register.
import {
  BelongsTo, Column, CreatedAt, DataType, Default, DeletedAt, ForeignKey,
  PrimaryKey, Table, UpdatedAt,
} from 'sequelize-typescript';
import {
  AssetCondition, AssetKind, AssetStatus,
} from '../../../common/constants/asset';
import { TenantScopedModel } from '../../../common/models/tenant-scoped.model';
import { Category } from './category.model';
import { Location } from './location.model';

@Table({
  tableName: 'assets',
  // paranoid: an asset is never hard-deleted. A written-off laptop still has to
  // appear in last year's audit.
  paranoid: true,
  indexes: [
    // Composite with tenantId, never UNIQUE(code) alone: two customers must
    // both be able to own TS-0001.
    { unique: true, fields: ['tenantId', 'code'] },
    { fields: ['tenantId', 'status'] },
    { fields: ['tenantId', 'locationId'] },
    { fields: ['tenantId', 'categoryId'] },
  ],
})
export class Asset extends TenantScopedModel {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @Column({ type: DataType.UUID, allowNull: false })
  declare tenantId: string;

  // Assigned by the server, immutable once issued. The update path rejects any
  // attempt to change it - it is printed on a label in the real world.
  @Column({ type: DataType.STRING(32), allowNull: false })
  declare code: string;

  @Default(AssetKind.ASSET)
  @Column(DataType.ENUM(...Object.values(AssetKind)))
  declare kind: AssetKind;

  @Column({ type: DataType.STRING(160), allowNull: false })
  declare name: string;

  @Column({ type: DataType.TEXT, allowNull: true })
  declare description: string | null;

  @ForeignKey(() => Category)
  @Column({ type: DataType.UUID, allowNull: true })
  declare categoryId: string | null;

  @BelongsTo(() => Category)
  declare category: Category;

  @ForeignKey(() => Location)
  @Column({ type: DataType.UUID, allowNull: true })
  declare locationId: string | null;

  @BelongsTo(() => Location)
  declare location: Location;

  // The person currently holding it. A plain UUID rather than a foreign key to
  // users: custody sometimes belongs to someone without a login.
  @Column({ type: DataType.UUID, allowNull: true })
  declare assignedToUserId: string | null;

  @Column({ type: DataType.STRING(120), allowNull: true })
  declare serialNumber: string | null;

  @Default(AssetStatus.IN_USE)
  @Column(DataType.ENUM(...Object.values(AssetStatus)))
  declare status: AssetStatus;

  @Default(AssetCondition.GOOD)
  @Column(DataType.ENUM(...Object.values(AssetCondition)))
  declare condition: AssetCondition;

  @Column({ type: DataType.DATEONLY, allowNull: true })
  declare purchaseDate: string | null;

  // DECIMAL, never FLOAT: money in a binary float loses cents, and this column
  // ends up in an insurance valuation.
  @Column({ type: DataType.DECIMAL(12, 2), allowNull: true })
  declare purchasePrice: string | null;

  // Only admin and owner may set this - it drives the insurance number.
  @Column({ type: DataType.DECIMAL(12, 2), allowNull: true })
  declare replacementValue: string | null;

  @Column({ type: DataType.STRING(160), allowNull: true })
  declare supplier: string | null;

  @Column({ type: DataType.DATEONLY, allowNull: true })
  declare warrantyEndsAt: string | null;

  // Consumables only. An individually tracked asset is always one row.
  @Default(1)
  @Column(DataType.INTEGER)
  declare quantity: number;

  @Default([])
  @Column(DataType.JSONB)
  declare imageIds: string[];

  @Default({})
  @Column(DataType.JSONB)
  declare customFields: Record<string, unknown>;

  @Column({ type: DataType.UUID, allowNull: true })
  declare createdByUserId: string | null;

  @CreatedAt declare createdAt: Date;
  @UpdatedAt declare updatedAt: Date;
  @DeletedAt declare deletedAt: Date | null;
}
