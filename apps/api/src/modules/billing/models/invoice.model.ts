// invoice.model.ts is the record of a charge.
//
// Written by the webhook, never by the app on its own: a row here means money
// actually moved, and the provider is the only thing that knows that.
import {
  BelongsTo, Column, CreatedAt, DataType, Default, ForeignKey, Model,
  PrimaryKey, Table, UpdatedAt,
} from 'sequelize-typescript';
import { Tenant } from '../../tenant/models/tenant.model';
import { Subscription } from './subscription.model';

export enum InvoiceStatus {
  /** Raised, not yet paid. A manual bank-transfer invoice sits here. */
  OPEN = 'open',
  PAID = 'paid',
  /** The payment failed. Dunning starts from here. */
  FAILED = 'failed',
  /** Raised in error. Never deleted - voided, so the number stays used. */
  VOID = 'void',
  REFUNDED = 'refunded',
}

@Table({
  tableName: 'invoices',
  indexes: [
    { fields: ['tenantId', 'createdAt'] },
    { unique: true, fields: ['number'] },
  ],
})
export class Invoice extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @ForeignKey(() => Tenant)
  @Column({ type: DataType.UUID, allowNull: false })
  declare tenantId: string;

  @BelongsTo(() => Tenant)
  declare tenant: Tenant;

  @ForeignKey(() => Subscription)
  @Column({ type: DataType.UUID, allowNull: true })
  declare subscriptionId: string | null;

  /**
   * Human-facing, sequential, and never reused - the same rule as an asset
   * code, for the same reason: it has been sent to a customer and may be in
   * their accountant's file.
   */
  @Column({ type: DataType.STRING(32), allowNull: false })
  declare number: string;

  @Default(InvoiceStatus.OPEN)
  @Column(DataType.ENUM(...Object.values(InvoiceStatus)))
  declare status: InvoiceStatus;

  @Column({ type: DataType.DECIMAL(10, 2), allowNull: false })
  declare amount: string;

  @Default('LKR')
  @Column(DataType.STRING(3))
  declare currency: string;

  @Column({ type: DataType.STRING(120), allowNull: true })
  declare providerRef: string | null;

  @Column({ type: DataType.DATE, allowNull: true })
  declare paidAt: Date | null;

  @Column({ type: DataType.TEXT, allowNull: true })
  declare note: string | null;

  @CreatedAt declare createdAt: Date;
  @UpdatedAt declare updatedAt: Date;
}
