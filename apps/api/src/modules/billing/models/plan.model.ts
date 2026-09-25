// plan.model.ts is the price list, stored as data.
//
// limits is JSONB on purpose: raising Free from 100 to 200 assets is a row
// update, not a deploy. -1 means unlimited.
import {
  Column, CreatedAt, DataType, Default, Model, PrimaryKey, Table, UpdatedAt,
} from 'sequelize-typescript';

export type PlanLimits = {
  assets: number;
  members: number;
  locations: number;
  photosPerAsset: number;
  storageBytes: number;
  auditRetentionDays: number;
  customFields: number;
};

@Table({ tableName: 'plans' })
export class Plan extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @Column({ type: DataType.STRING(32), allowNull: false, unique: true })
  declare code: string;

  @Column({ type: DataType.STRING(80), allowNull: false })
  declare name: string;

  // DECIMAL, never FLOAT. Money in a binary float silently loses cents.
  @Default(0)
  @Column(DataType.DECIMAL(10, 2))
  declare priceMonthly: string;

  @Default(0)
  @Column(DataType.DECIMAL(10, 2))
  declare priceYearly: string;

  @Default('LKR')
  @Column(DataType.STRING(3))
  declare currency: string;

  @Column({ type: DataType.JSONB, allowNull: false })
  declare limits: PlanLimits;

  @Default({})
  @Column(DataType.JSONB)
  declare features: Record<string, boolean>;

  @Default(true)
  @Column(DataType.BOOLEAN)
  declare isPublic: boolean;

  @Default(0)
  @Column(DataType.INTEGER)
  declare sortOrder: number;

  @CreatedAt declare createdAt: Date;
  @UpdatedAt declare updatedAt: Date;
}
