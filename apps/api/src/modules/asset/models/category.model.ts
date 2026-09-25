// category.model.ts groups assets for reporting and depreciation defaults.
import {
  BelongsTo, Column, CreatedAt, DataType, Default, ForeignKey,
  PrimaryKey, Table, UpdatedAt,
} from 'sequelize-typescript';
import { TenantScopedModel } from '../../../common/models/tenant-scoped.model';

@Table({
  tableName: 'categories',
  indexes: [{ unique: true, fields: ['tenantId', 'name'] }],
})
export class Category extends TenantScopedModel {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @Column({ type: DataType.UUID, allowNull: false })
  declare tenantId: string;

  @Column({ type: DataType.STRING(120), allowNull: false })
  declare name: string;

  @ForeignKey(() => Category)
  @Column({ type: DataType.UUID, allowNull: true })
  declare parentId: string | null;

  @BelongsTo(() => Category, 'parentId')
  declare parent: Category;

  // Feeds a depreciation report later; kept here so the default travels with
  // the category rather than being retyped on every asset.
  @Column({ type: DataType.INTEGER, allowNull: true })
  declare defaultUsefulLifeMonths: number | null;

  @CreatedAt declare createdAt: Date;
  @UpdatedAt declare updatedAt: Date;
}
