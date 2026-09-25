// asset-movement.model.ts records where a thing went and who had it.
//
// Append-only. The current location on the asset row is a cache of the latest
// movement; this table is the history that answers "where was it in March?".
import {
  BelongsTo, Column, CreatedAt, DataType, Default, ForeignKey,
  PrimaryKey, Table,
} from 'sequelize-typescript';
import { TenantScopedModel } from '../../../common/models/tenant-scoped.model';
import { Asset } from './asset.model';
import { Location } from './location.model';

@Table({
  tableName: 'asset_movements',
  updatedAt: false,
  indexes: [{ fields: ['tenantId', 'assetId'] }],
})
export class AssetMovement extends TenantScopedModel {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @Column({ type: DataType.UUID, allowNull: false })
  declare tenantId: string;

  @ForeignKey(() => Asset)
  @Column({ type: DataType.UUID, allowNull: false })
  declare assetId: string;

  @BelongsTo(() => Asset)
  declare asset: Asset;

  @ForeignKey(() => Location)
  @Column({ type: DataType.UUID, allowNull: true })
  declare fromLocationId: string | null;

  @ForeignKey(() => Location)
  @Column({ type: DataType.UUID, allowNull: true })
  declare toLocationId: string | null;

  @Column({ type: DataType.UUID, allowNull: true })
  declare fromUserId: string | null;

  @Column({ type: DataType.UUID, allowNull: true })
  declare toUserId: string | null;

  @Column({ type: DataType.UUID, allowNull: false })
  declare movedByUserId: string;

  @Column({ type: DataType.TEXT, allowNull: true })
  declare note: string | null;

  @CreatedAt declare movedAt: Date;
}
