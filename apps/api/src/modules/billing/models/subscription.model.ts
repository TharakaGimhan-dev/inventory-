// subscription.model.ts is what a tenant is paying for, and until when.
//
// Separate from the tenant row because a tenant outlives its subscriptions: it
// may cancel, sit read-only, and come back six months later. The history of
// what they paid for has to survive that.
import {
  BelongsTo, Column, CreatedAt, DataType, Default, ForeignKey, Model,
  PrimaryKey, Table, UpdatedAt,
} from 'sequelize-typescript';
import { Tenant } from '../../tenant/models/tenant.model';
import { Plan } from './plan.model';

export enum SubscriptionStatus {
  /** Created, waiting for the first successful payment. */
  PENDING = 'pending',
  ACTIVE = 'active',
  /** A renewal failed. Full access continues through the dunning window. */
  PAST_DUE = 'past_due',
  /** Cancelled, or dunning ran out. */
  CANCELLED = 'cancelled',
}

export enum PaymentProviderName {
  PAYHERE = 'payhere',
  /** Bank transfer, invoiced by hand. SME customers will ask for this. */
  MANUAL = 'manual',
}

@Table({
  tableName: 'subscriptions',
  indexes: [
    { fields: ['tenantId', 'status'] },
    { fields: ['providerRef'] },
  ],
})
export class Subscription extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @ForeignKey(() => Tenant)
  @Column({ type: DataType.UUID, allowNull: false })
  declare tenantId: string;

  @BelongsTo(() => Tenant)
  declare tenant: Tenant;

  @ForeignKey(() => Plan)
  @Column({ type: DataType.UUID, allowNull: false })
  declare planId: string;

  @BelongsTo(() => Plan)
  declare plan: Plan;

  @Default(SubscriptionStatus.PENDING)
  @Column(DataType.ENUM(...Object.values(SubscriptionStatus)))
  declare status: SubscriptionStatus;

  @Column(DataType.ENUM(...Object.values(PaymentProviderName)))
  declare provider: PaymentProviderName;

  /**
   * The provider's own id for this subscription.
   *
   * Nullable because PayHere only issues one after the first payment clears -
   * between checkout and the first webhook there is nothing to store.
   */
  @Column({ type: DataType.STRING(120), allowNull: true })
  declare providerRef: string | null;

  @Column({ type: DataType.DECIMAL(10, 2), allowNull: false })
  declare amount: string;

  @Default('LKR')
  @Column(DataType.STRING(3))
  declare currency: string;

  @Column({ type: DataType.DATE, allowNull: true })
  declare currentPeriodStart: Date | null;

  @Column({ type: DataType.DATE, allowNull: true })
  declare currentPeriodEnd: Date | null;

  /** Set when the customer cancels but has already paid for this period. */
  @Default(false)
  @Column(DataType.BOOLEAN)
  declare cancelAtPeriodEnd: boolean;

  @Column({ type: DataType.DATE, allowNull: true })
  declare cancelledAt: Date | null;

  /** When the current dunning window started, so the guard can measure it. */
  @Column({ type: DataType.DATE, allowNull: true })
  declare pastDueSince: Date | null;

  @CreatedAt declare createdAt: Date;
  @UpdatedAt declare updatedAt: Date;
}
