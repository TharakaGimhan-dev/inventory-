// counter.model.ts issues asset codes.
//
// One row per tenant per counter key. The value is read and incremented inside
// the same transaction as the asset insert, with a row lock, so two people
// capturing at once cannot both be handed TS-0007.
//
// The counter never rewinds. A code that has been issued has been printed on a
// label and stuck to equipment - spec section 5.4.
import {
  Column, CreatedAt, DataType, Default, PrimaryKey, Table, UpdatedAt,
} from 'sequelize-typescript';
import { TenantScopedModel } from '../../../common/models/tenant-scoped.model';

@Table({
  tableName: 'counters',
  indexes: [{ unique: true, fields: ['tenantId', 'key'] }],
})
export class Counter extends TenantScopedModel {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @Column({ type: DataType.UUID, allowNull: false })
  declare tenantId: string;

  @Column({ type: DataType.STRING(40), allowNull: false })
  declare key: string;

  @Default(0)
  @Column(DataType.INTEGER)
  declare value: number;

  @CreatedAt declare createdAt: Date;
  @UpdatedAt declare updatedAt: Date;
}
