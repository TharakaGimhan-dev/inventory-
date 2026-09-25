// location.model.ts is where an asset physically is. Self-referencing, so a
// tenant can model Floor 2 > Meeting Room without a second table.
import {
  BelongsTo, Column, CreatedAt, DataType, Default, ForeignKey,
  PrimaryKey, Table, UpdatedAt,
} from 'sequelize-typescript';
import { TenantScopedModel } from '../../../common/models/tenant-scoped.model';

@Table({
  tableName: 'locations',
  indexes: [{ unique: true, fields: ['tenantId', 'name', 'parentId'] }],
})
export class Location extends TenantScopedModel {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @Column({ type: DataType.UUID, allowNull: false })
  declare tenantId: string;

  @Column({ type: DataType.STRING(120), allowNull: false })
  declare name: string;

  @ForeignKey(() => Location)
  @Column({ type: DataType.UUID, allowNull: true })
  declare parentId: string | null;

  @BelongsTo(() => Location, 'parentId')
  declare parent: Location;

  @Column({ type: DataType.STRING(32), allowNull: true })
  declare code: string | null;

  @Default(true)
  @Column(DataType.BOOLEAN)
  declare isActive: boolean;

  @CreatedAt declare createdAt: Date;
  @UpdatedAt declare updatedAt: Date;
}
